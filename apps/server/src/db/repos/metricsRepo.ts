// Metrics queries (docs/05). Every function takes an optional campaign scope
// and an optional asOf cutoff (occurred_at <= asOf) so mid-campaign snapshots
// are the same queries with a filter. SQL lives here; the public metric API
// (shapes, rounding, watch rules) is services/metrics.
import { sql, type SQL } from 'drizzle-orm';
import type { DbLike } from '../client';
import { leads, mailboxes } from '../schema';

export interface MetricScope {
  campaignId?: number | null;
  asOf?: Date | null;
}

function evFilter(alias: string, scope: MetricScope): SQL {
  const parts: SQL[] = [
    sql` AND EXISTS (SELECT 1 FROM ${leads} l WHERE l.id = ${sql.raw(alias)}.lead_id AND NOT l.is_erased)`,
  ];
  if (scope.campaignId != null)
    parts.push(sql` AND ${sql.raw(alias)}.campaign_id = ${scope.campaignId}`);
  if (scope.asOf != null) parts.push(sql` AND ${sql.raw(alias)}.occurred_at <= ${scope.asOf}`);
  return parts.length ? sql.join(parts) : sql``;
}

async function one<T>(db: DbLike, q: SQL): Promise<T> {
  const res = await db.execute(q);
  return (res as { rows: T[] }).rows[0]!;
}
async function all<T>(db: DbLike, q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return (res as { rows: T[] }).rows;
}

/** Effective sentiment per reply (decision M): latest sentiment_tagged wins over the insert value. */
function replySentimentCte(scope: MetricScope): SQL {
  return sql`
    reply_sentiment AS (
      SELECT hr.id, hr.lead_id, hr.enrollment_id, hr.campaign_id, hr.step_no, hr.occurred_at,
             COALESCE(
               (SELECT st.sentiment FROM events st
                 WHERE st.type = 'sentiment_tagged'
                   AND (st.attributes->>'reply_event_id')::bigint = hr.id
                   ${scope.asOf != null ? sql`AND st.occurred_at <= ${scope.asOf}` : sql``}
                 ORDER BY st.id DESC LIMIT 1),
               hr.sentiment) AS sentiment
      FROM events hr
      WHERE hr.type = 'human_reply'${evFilter('hr', scope)}
    )`;
}

const distinctLeads = async (db: DbLike, type: string, scope: MetricScope): Promise<number> =>
  (
    await one<{ n: number }>(
      db,
      sql`SELECT count(DISTINCT e.lead_id)::int n FROM events e
          WHERE e.type = ${type}${evFilter('e', scope)}`,
    )
  ).n;

/**
 * A lead is contacted as soon as we have either a delivery confirmation or a
 * human reply.  Replies can arrive before the delayed delivery-confirmation
 * job runs; counting the union makes that real-world outcome visible without
 * ever double-counting a lead when the confirmation arrives later.
 */
export async function countContacted(db: DbLike, scope: MetricScope): Promise<number> {
  return (
    await one<{ n: number }>(
      db,
      sql`SELECT count(DISTINCT e.lead_id)::int n FROM events e
          WHERE e.type IN ('delivered', 'human_reply')${evFilter('e', scope)}`,
    )
  ).n;
}
export const countLeadsSentTo = (db: DbLike, scope: MetricScope) =>
  distinctLeads(db, 'sent', scope);
export const countDistinctRepliers = (db: DbLike, scope: MetricScope) =>
  distinctLeads(db, 'human_reply', scope);
export const countUnsubscribedLeads = (db: DbLike, scope: MetricScope) =>
  distinctLeads(db, 'unsubscribe', scope);

export async function countEvents(
  db: DbLike,
  type: 'sent' | 'hard_bounce' | 'soft_bounce' | 'meeting_booked',
  scope: MetricScope,
): Promise<number> {
  return (
    await one<{ n: number }>(
      db,
      sql`SELECT count(*)::int n FROM events e WHERE e.type = ${type}${evFilter('e', scope)}`,
    )
  ).n;
}

export async function countPositiveReplierLeads(db: DbLike, scope: MetricScope): Promise<number> {
  return (
    await one<{ n: number }>(
      db,
      sql`WITH ${replySentimentCte(scope)}
          SELECT count(DISTINCT lead_id)::int n FROM reply_sentiment WHERE sentiment = 'positive'`,
    )
  ).n;
}

export async function countEnrollments(db: DbLike, campaignId: number | null): Promise<number> {
  return (
    await one<{ n: number }>(
      db,
      sql`SELECT count(*)::int n FROM enrollments en
          JOIN ${leads} l ON l.id = en.lead_id AND NOT l.is_erased
          WHERE ${campaignId != null ? sql`en.campaign_id = ${campaignId}` : sql`true`}`,
    )
  ).n;
}

// ── groupings ────────────────────────────────────────────────────────────────

export interface StepStatsRow {
  step_no: number;
  delivered: number;
  repliers: number;
  positive_repliers: number;
}

export async function stepStats(db: DbLike, scope: MetricScope): Promise<StepStatsRow[]> {
  return all<StepStatsRow>(
    db,
    sql`WITH ${replySentimentCte(scope)},
      d AS (SELECT e.step_no, count(DISTINCT e.lead_id)::int delivered FROM events e
            WHERE e.type = 'delivered'${evFilter('e', scope)} GROUP BY e.step_no),
      r AS (SELECT step_no, count(DISTINCT lead_id)::int repliers,
                   count(DISTINCT lead_id) FILTER (WHERE sentiment = 'positive')::int positive_repliers
            FROM reply_sentiment GROUP BY step_no)
      SELECT d.step_no, d.delivered,
             COALESCE(r.repliers, 0) repliers,
             COALESCE(r.positive_repliers, 0) positive_repliers
      FROM d LEFT JOIN r USING (step_no)
      ORDER BY d.step_no`,
  );
}

export interface TierStatsRow {
  tier: string | null;
  contacted: number;
  repliers: number;
  positive_repliers: number;
  meetings: number;
  mode: string | null;
}

export async function tierStats(db: DbLike, scope: MetricScope): Promise<TierStatsRow[]> {
  return all<TierStatsRow>(
    db,
    sql`WITH ${replySentimentCte(scope)},
      c AS (SELECT en.enrolled_tier tier, count(DISTINCT e.lead_id)::int contacted
            FROM events e JOIN enrollments en ON en.id = e.enrollment_id
            WHERE e.type = 'delivered'${evFilter('e', scope)} GROUP BY 1),
      r AS (SELECT en.enrolled_tier tier, count(DISTINCT rs.lead_id)::int repliers,
                   count(DISTINCT rs.lead_id) FILTER (WHERE rs.sentiment = 'positive')::int positive_repliers
            FROM reply_sentiment rs JOIN enrollments en ON en.id = rs.enrollment_id GROUP BY 1),
      m AS (SELECT en.enrolled_tier tier, count(*)::int meetings
            FROM events e JOIN enrollments en ON en.id = e.enrollment_id
            WHERE e.type = 'meeting_booked'${evFilter('e', scope)} GROUP BY 1),
      md AS (SELECT enrolled_tier tier,
                    mode() WITHIN GROUP (ORDER BY personalization_mode)::text AS mode
             FROM enrollments en JOIN ${leads} l ON l.id = en.lead_id AND NOT l.is_erased
             WHERE ${scope.campaignId != null ? sql`en.campaign_id = ${scope.campaignId}` : sql`true`}
             GROUP BY 1)
      SELECT c.tier::text, c.contacted,
             COALESCE(r.repliers, 0) repliers,
             COALESCE(r.positive_repliers, 0) positive_repliers,
             COALESCE(m.meetings, 0) meetings,
             md.mode
      FROM c
      LEFT JOIN r ON r.tier IS NOT DISTINCT FROM c.tier
      LEFT JOIN m ON m.tier IS NOT DISTINCT FROM c.tier
      LEFT JOIN md ON md.tier IS NOT DISTINCT FROM c.tier
      ORDER BY c.tier NULLS LAST`,
  );
}

export interface VariantStatsRow {
  variant_id: number | null;
  sent: number;
  direct_delivered: number;
  direct_contacted: number;
  direct_repliers: number;
  direct_positive_repliers: number;
  cohort: number;
  eventual_repliers: number;
  eventual_positive_repliers: number;
  meetings: number;
}

/**
 * Per-variant analytics for any selected step. The human_reply event's step_no
 * is the classifier's persisted thread match, so it is the authoritative
 * direct-response attribution. Eventual outcomes use the enrollment cohort.
 */
export async function variantStats(
  db: DbLike,
  scope: MetricScope,
  stepNo: number,
): Promise<VariantStatsRow[]> {
  return all<VariantStatsRow>(
    db,
    sql`WITH ${replySentimentCte(scope)},
      cohort AS (
        SELECT e.enrollment_id, e.lead_id,
               (e.attributes->>'variant_id')::bigint variant_id,
               min(e.occurred_at) first_sent_at,
               count(*)::int sent
        FROM events e
        WHERE e.type = 'sent' AND e.step_no = ${stepNo}${evFilter('e', scope)}
        GROUP BY e.enrollment_id, e.lead_id, (e.attributes->>'variant_id')::bigint),
      delivered AS (
        SELECT DISTINCT c.enrollment_id, c.variant_id
        FROM cohort c JOIN events e ON e.enrollment_id = c.enrollment_id
        WHERE e.type = 'delivered' AND e.step_no = ${stepNo}
          AND e.occurred_at >= c.first_sent_at${evFilter('e', scope)}),
      direct_reply AS (
        SELECT c.enrollment_id, c.variant_id,
               bool_or(rs.sentiment = 'positive') positive
        FROM cohort c JOIN reply_sentiment rs ON rs.enrollment_id = c.enrollment_id
        WHERE rs.step_no = ${stepNo} AND rs.occurred_at >= c.first_sent_at
        GROUP BY c.enrollment_id, c.variant_id),
      eventual_reply AS (
        SELECT c.enrollment_id, c.variant_id,
               bool_or(rs.sentiment = 'positive') positive
        FROM cohort c JOIN reply_sentiment rs ON rs.enrollment_id = c.enrollment_id
        WHERE rs.occurred_at >= c.first_sent_at
        GROUP BY c.enrollment_id, c.variant_id),
      meeting AS (
        SELECT DISTINCT c.enrollment_id, c.variant_id
        FROM cohort c JOIN events e ON e.enrollment_id = c.enrollment_id
        WHERE e.type = 'meeting_booked' AND e.occurred_at >= c.first_sent_at${evFilter('e', scope)})
      SELECT c.variant_id,
             sum(c.sent)::int sent,
             count(DISTINCT d.enrollment_id)::int direct_delivered,
             count(DISTINCT c.enrollment_id) FILTER (
               WHERE d.enrollment_id IS NOT NULL OR dr.enrollment_id IS NOT NULL
             )::int direct_contacted,
             count(DISTINCT dr.enrollment_id)::int direct_repliers,
             count(DISTINCT dr.enrollment_id) FILTER (WHERE dr.positive)::int
               direct_positive_repliers,
             count(DISTINCT c.enrollment_id)::int cohort,
             count(DISTINCT er.enrollment_id)::int eventual_repliers,
             count(DISTINCT er.enrollment_id) FILTER (WHERE er.positive)::int
               eventual_positive_repliers,
             count(DISTINCT m.enrollment_id)::int meetings
      FROM cohort c
      LEFT JOIN delivered d ON d.enrollment_id = c.enrollment_id AND d.variant_id = c.variant_id
      LEFT JOIN direct_reply dr ON dr.enrollment_id = c.enrollment_id AND dr.variant_id = c.variant_id
      LEFT JOIN eventual_reply er ON er.enrollment_id = c.enrollment_id AND er.variant_id = c.variant_id
      LEFT JOIN meeting m ON m.enrollment_id = c.enrollment_id AND m.variant_id = c.variant_id
      GROUP BY c.variant_id ORDER BY c.variant_id NULLS LAST`,
  );
}

export interface DailySeriesRow {
  day: string; // YYYY-MM-DD
  sent: number;
  delivered: number;
  replies: number;
  hard_bounces: number;
  unsubscribes: number;
}

export async function dailySeries(
  db: DbLike,
  scope: MetricScope,
  from: Date,
  to: Date,
): Promise<DailySeriesRow[]> {
  return all<DailySeriesRow>(
    db,
    sql`SELECT to_char(date_trunc('day', e.occurred_at), 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE e.type = 'sent')::int sent,
           count(*) FILTER (WHERE e.type = 'delivered')::int delivered,
           count(*) FILTER (WHERE e.type = 'human_reply')::int replies,
           count(*) FILTER (WHERE e.type = 'hard_bounce')::int hard_bounces,
           count(*) FILTER (WHERE e.type = 'unsubscribe')::int unsubscribes
        FROM events e
        WHERE e.occurred_at >= ${from} AND e.occurred_at <= ${to}
          AND EXISTS (SELECT 1 FROM ${leads} l WHERE l.id = e.lead_id AND NOT l.is_erased)
          ${scope.campaignId != null ? sql`AND e.campaign_id = ${scope.campaignId}` : sql``}
        GROUP BY 1 ORDER BY 1`,
  );
}

/**
 * 13c promotable count: Tier-C enrollments that replied — the "[Promote N
 * engaged Tier-C → Tier B]" number (docs/12 §12).
 */
export async function tierCEngagedCount(db: DbLike, scope: MetricScope): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM enrollments e
        JOIN ${leads} l ON l.id = e.lead_id AND NOT l.is_erased
        WHERE e.enrolled_tier = 'C'
          ${scope.campaignId != null ? sql`AND e.campaign_id = ${scope.campaignId}` : sql``}
          AND EXISTS (SELECT 1 FROM events hr
                       WHERE hr.type = 'human_reply' AND hr.enrollment_id = e.id
                       ${scope.asOf != null ? sql`AND hr.occurred_at <= ${scope.asOf}` : sql``})`,
  );
  return row.n;
}

export interface MailboxVolumeRow {
  mailbox_id: number;
  day: string;
  sends: number;
}

export async function mailboxVolume(db: DbLike, from: Date, to: Date): Promise<MailboxVolumeRow[]> {
  return all<MailboxVolumeRow>(
    db,
    sql`SELECT e.mailbox_id::int,
           to_char(e.occurred_at AT TIME ZONE mb.timezone, 'YYYY-MM-DD') AS day,
           count(*)::int sends
        FROM events e
        JOIN ${mailboxes} mb ON mb.id = e.mailbox_id
        WHERE e.type = 'sent' AND e.mailbox_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM ${leads} l WHERE l.id = e.lead_id AND NOT l.is_erased)
          AND e.occurred_at >= ${from} AND e.occurred_at <= ${to}
        GROUP BY 1, 2 ORDER BY 1, 2`,
  );
}

// ── self-check (docs/04 §4 invariants, queryable form) ───────────────────────

export interface SelfCheckViolation {
  rule: string;
  count: number;
}

export async function selfCheckViolations(
  db: DbLike,
  campaignId: number | null,
): Promise<SelfCheckViolation[]> {
  const c = campaignId;
  const enrFilter = c != null ? sql`AND en.campaign_id = ${c}` : sql``;
  const checks: [string, SQL][] = [
    [
      'enrollment count != enrolled events',
      sql`SELECT abs((SELECT count(*) FROM enrollments en WHERE true ${enrFilter})
            - (SELECT count(*) FROM events e WHERE e.type = 'enrolled'
               ${c != null ? sql`AND e.campaign_id = ${c}` : sql``}))::int n`,
    ],
    [
      'UNSUBSCRIBED without unsubscribe event',
      sql`SELECT count(*)::int n FROM enrollments en
          WHERE en.current_state = 'UNSUBSCRIBED' ${enrFilter}
            AND NOT EXISTS (SELECT 1 FROM events e
              WHERE e.enrollment_id = en.id AND e.type = 'unsubscribe')`,
    ],
    [
      'unsubscribe event without UNSUBSCRIBED state',
      sql`SELECT count(DISTINCT en.id)::int n FROM enrollments en
          JOIN events e ON e.enrollment_id = en.id AND e.type = 'unsubscribe'
          WHERE en.current_state != 'UNSUBSCRIBED' ${enrFilter}`,
    ],
    [
      'hard_bounce (no unsubscribe) not BOUNCED',
      sql`SELECT count(DISTINCT en.id)::int n FROM enrollments en
          JOIN events e ON e.enrollment_id = en.id AND e.type = 'hard_bounce'
          WHERE en.current_state != 'BOUNCED' ${enrFilter}
            AND NOT EXISTS (SELECT 1 FROM events u
              WHERE u.enrollment_id = en.id AND u.type = 'unsubscribe')`,
    ],
    [
      'REPLIED without human_reply event',
      sql`SELECT count(*)::int n FROM enrollments en
          WHERE en.current_state = 'REPLIED' ${enrFilter}
            AND NOT EXISTS (SELECT 1 FROM events e
              WHERE e.enrollment_id = en.id AND e.type = 'human_reply')`,
    ],
    [
      'meeting_booked flag without human_reply event',
      sql`SELECT count(*)::int n FROM enrollments en
          WHERE en.meeting_booked ${enrFilter}
            AND NOT EXISTS (SELECT 1 FROM events e
              WHERE e.enrollment_id = en.id AND e.type = 'human_reply')`,
    ],
    [
      'terminal suppression event without suppressed lead',
      sql`SELECT count(DISTINCT l.id)::int n FROM leads l
          JOIN events e ON e.lead_id = l.id AND e.type IN ('unsubscribe', 'hard_bounce')
           WHERE NOT l.is_erased AND (NOT l.is_suppressed
              OR NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = l.email))`,
    ],
  ];

  const out: SelfCheckViolation[] = [];
  for (const [rule, q] of checks) {
    const { n } = await one<{ n: number }>(db, q);
    if (n > 0) out.push({ rule, count: n });
  }
  return out;
}
