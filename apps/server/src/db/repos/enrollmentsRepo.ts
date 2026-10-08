import { and, asc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { isTerminal, type LeadTier, type PersonalizationMode } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaigns, enrollments, leads } from '../schema';
import type { EnrollmentSnapshot } from '../../domain/reducer';

export type EnrollmentRow = typeof enrollments.$inferSelect;

/**
 * Write the reducer-derived projection columns. next_send_at is cleared on
 * terminal states (nothing left to schedule); otherwise it belongs to the
 * scheduler and is left untouched here.
 */
export async function writeProjection(
  db: DbLike,
  enrollmentId: number,
  s: EnrollmentSnapshot,
): Promise<void> {
  const terminal = isTerminal(s.state);
  await db
    .update(enrollments)
    .set({
      currentState: s.state,
      currentStepNo: s.currentStepNo,
      softBounceRetries: s.softBounceRetries,
      bestReplySentiment: s.bestReplySentiment,
      meetingBooked: s.meetingBooked,
      terminalAt: s.terminalAt,
      reviewHoldIds: s.reviewHoldIds ?? [],
      reviewRevision: s.reviewRevision ?? 0,
      delayedUntil: s.delayedUntil ?? null,
      resumeDueAt: s.resumeDueAt ?? null,
      manualStopEventId: s.manualStopEventId ?? null,
      ...(terminal ? { nextSendAt: null } : {}),
    })
    .where(eq(enrollments.id, enrollmentId));
}

/** Scheduling columns the reducer can't derive (docs/02 §3) — eventStore-only writer. */
export async function patchScheduling(
  db: DbLike,
  enrollmentId: number,
  patch: { nextSendAt?: Date | null; assignedMailboxId?: number; snoozedUntil?: Date | null },
): Promise<void> {
  const set: Partial<typeof enrollments.$inferInsert> = {};
  if (patch.nextSendAt !== undefined) set.nextSendAt = patch.nextSendAt;
  if (patch.assignedMailboxId !== undefined) set.assignedMailboxId = patch.assignedMailboxId;
  if (patch.snoozedUntil !== undefined) set.snoozedUntil = patch.snoozedUntil;
  if (Object.keys(set).length === 0) return;
  await db.update(enrollments).set(set).where(eq(enrollments.id, enrollmentId));
}

/** A due ACTIVE enrollment joined with what sendOne needs from the lead. */
export interface DueEnrollment {
  id: number;
  leadId: number;
  campaignId: number;
  currentStepNo: number;
  assignedMailboxId: number | null;
  nextSendAt: Date;
  reviewRevision?: number;
  personalizationMode: PersonalizationMode;
  leadEmail: string;
  leadFirstName: string | null;
  leadCompany: string | null;
  leadWebsite: string | null;
  leadCity: string | null;
  leadState: string | null;
  leadCustomFields: Record<string, string>;
}

/**
 * Due work, oldest-first (docs/06 §1 C): ACTIVE enrollment in an ACTIVE
 * campaign, next_send_at <= now, not snoozed. Oldest-first ordering + budgets
 * IS the catch-up mechanism. Suppressed leads are excluded — send-time is one
 * of suppression's four enforcement layers. The campaign-status join keeps
 * draft/paused campaigns silent — recycle (docs/09 §6) enrolls into a DRAFT
 * campaign that must not send until activated.
 */
export async function listDue(db: DbLike, now: Date): Promise<DueEnrollment[]> {
  const rows = await db
    .select({
      id: enrollments.id,
      leadId: enrollments.leadId,
      campaignId: enrollments.campaignId,
      currentStepNo: enrollments.currentStepNo,
      assignedMailboxId: enrollments.assignedMailboxId,
      nextSendAt: enrollments.nextSendAt,
      reviewRevision: enrollments.reviewRevision,
      personalizationMode: enrollments.personalizationMode,
      leadEmail: leads.email,
      leadFirstName: leads.firstName,
      leadCompany: leads.company,
      leadWebsite: leads.website,
      leadCity: leads.city,
      leadState: leads.state,
      leadCustomFields: leads.customFields,
    })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .innerJoin(campaigns, eq(campaigns.id, enrollments.campaignId))
    .where(
      and(
        eq(enrollments.currentState, 'ACTIVE'),
        sql`cardinality(${enrollments.reviewHoldIds}) = 0`,
        or(isNull(enrollments.delayedUntil), lte(enrollments.delayedUntil, now)),
        eq(campaigns.status, 'active'),
        lte(enrollments.nextSendAt, now),
        or(isNull(enrollments.snoozedUntil), lte(enrollments.snoozedUntil, now)),
        eq(leads.isSuppressed, false),
        eq(leads.isErased, false),
      ),
    )
    .orderBy(asc(enrollments.nextSendAt), asc(enrollments.id));
  return rows.map((r) => ({
    ...r,
    nextSendAt: r.nextSendAt!,
    leadCustomFields: (r.leadCustomFields ?? {}) as Record<string, string>,
  }));
}

/**
 * Completion candidates: ACTIVE enrollments already past the sequence's last
 * step (shouldComplete requires currentStepNo > lastStepNo, so this SQL
 * prefilter is exact — it just avoids folding every ACTIVE enrollment).
 */
export async function listIdsActivePastStep(
  db: DbLike,
  campaignId: number | null,
  lastStepNo: number,
): Promise<number[]> {
  const base = and(
    eq(enrollments.currentState, 'ACTIVE'),
    sql`${enrollments.currentStepNo} > ${lastStepNo}`,
  );
  const rows = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(campaignId === null ? base : and(base, eq(enrollments.campaignId, campaignId)));
  return rows.map((r) => r.id);
}

/** Campaigns that still have ACTIVE enrollments — the tick's completion sweep set. */
export async function activeCampaignIds(db: DbLike): Promise<number[]> {
  const rows = await db
    .selectDistinct({ campaignId: enrollments.campaignId })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(and(eq(enrollments.currentState, 'ACTIVE'), eq(leads.isErased, false)));
  return rows.map((r) => r.campaignId);
}

/** Follow-ups still owed before `before` (capacity formula, docs/06 §7). */
export async function countFollowupsDue(db: DbLike, before: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(
      and(
        eq(enrollments.currentState, 'ACTIVE'),
        isNotNull(enrollments.assignedMailboxId), // assigned at first send ⇒ ≥1 sent
        lt(enrollments.nextSendAt, before),
        eq(leads.isErased, false),
        eq(leads.isSuppressed, false),
        sql`cardinality(${enrollments.reviewHoldIds}) = 0`,
        or(isNull(enrollments.delayedUntil), lt(enrollments.delayedUntil, before)),
        sql`NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = ${leads.email})`,
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Unsent Step-1 work already reserved in active campaigns for this local day. */
export async function countPendingOpenersDue(db: DbLike, before: Date): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM enrollments e
      JOIN campaigns c ON c.id = e.campaign_id AND c.status = 'active'
      JOIN leads l ON l.id = e.lead_id AND NOT l.is_erased AND NOT l.is_suppressed
     WHERE e.current_state = 'ACTIVE'
       AND e.assigned_mailbox_id IS NULL
       AND e.current_step_no = 1
       AND cardinality(e.review_hold_ids) = 0
       AND (e.delayed_until IS NULL OR e.delayed_until < ${before})
       AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = l.email)
       AND e.next_send_at < ${before}`);
  return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/** Enrollments created today (ramp cap accounting). */
export async function countEnrolledSince(
  db: DbLike,
  campaignId: number,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(
      and(
        eq(enrollments.campaignId, campaignId),
        gte(enrollments.enrolledAt, since),
        eq(leads.isErased, false),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Cold storage source rows (docs/09 §6): COMPLETED in the source campaign, lead not suppressed. */
export interface ColdStorageRow {
  leadId: number;
  email: string;
  tier: LeadTier | null;
  completedAt: Date;
}

export async function coldStorageRows(
  db: DbLike,
  sourceCampaignId: number,
): Promise<ColdStorageRow[]> {
  const rows = await db
    .select({
      leadId: enrollments.leadId,
      email: leads.email,
      tier: leads.tier,
      completedAt: enrollments.terminalAt,
    })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(
      and(
        eq(enrollments.campaignId, sourceCampaignId),
        eq(enrollments.currentState, 'COMPLETED'),
        eq(leads.isSuppressed, false),
        eq(leads.isErased, false),
      ),
    )
    .orderBy(asc(enrollments.terminalAt), asc(enrollments.leadId));
  return rows.map((r) => ({ ...r, completedAt: r.completedAt! }));
}

/** Which of these leads already have an enrollment in the campaign. */
export async function enrolledLeadIdsIn(
  db: DbLike,
  campaignId: number,
  leadIds: readonly number[],
): Promise<Set<number>> {
  if (leadIds.length === 0) return new Set();
  const rows = await db
    .select({ leadId: enrollments.leadId })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.campaignId, campaignId),
        sql`${enrollments.leadId} = ANY(${sql.param([...leadIds])}::bigint[])`,
      ),
    );
  return new Set(rows.map((r) => r.leadId));
}

export interface NewEnrollment {
  leadId: number;
  campaignId: number;
  enrolledTier: LeadTier | null;
  personalizationMode: PersonalizationMode;
  enrolledAt: Date;
}

export async function insertEnrollments(
  db: DbLike,
  rows: readonly NewEnrollment[],
): Promise<number[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(enrollments)
    .values(rows.map((r) => ({ ...r, currentState: 'NEW' as const })))
    .returning({ id: enrollments.id });
  return inserted.map((r) => r.id);
}

/** The one enrollment for (lead, campaign) — UNIQUE(lead_id, campaign_id). */
export async function findByLeadAndCampaign(
  db: DbLike,
  leadId: number,
  campaignId: number,
): Promise<EnrollmentRow | undefined> {
  const rows = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.leadId, leadId), eq(enrollments.campaignId, campaignId)));
  return rows[0];
}

/**
 * Bounce matching (docs/07 §2.1): the lead's most recent ACTIVE enrollment,
 * else the most recent one — a DSN can trail the terminal transition.
 */
export async function latestForLead(
  db: DbLike,
  leadId: number,
): Promise<EnrollmentRow | undefined> {
  const rows = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.leadId, leadId))
    .orderBy(sql`${enrollments.enrolledAt} DESC`, sql`${enrollments.id} DESC`);
  return rows.find((r) => r.currentState === 'ACTIVE') ?? rows[0];
}

export async function getById(db: DbLike, id: number): Promise<EnrollmentRow | undefined> {
  const rows = await db.select().from(enrollments).where(eq(enrollments.id, id));
  return rows[0];
}

export async function listForLead(
  db: DbLike,
  leadId: number,
): Promise<
  Array<Pick<EnrollmentRow, 'id' | 'campaignId' | 'currentState' | 'personalizationMode'>>
> {
  return db
    .select({
      id: enrollments.id,
      campaignId: enrollments.campaignId,
      currentState: enrollments.currentState,
      personalizationMode: enrollments.personalizationMode,
    })
    .from(enrollments)
    .where(eq(enrollments.leadId, leadId));
}

export async function listAll(db: DbLike, campaignId: number | null): Promise<EnrollmentRow[]> {
  return campaignId === null
    ? db.select().from(enrollments)
    : db.select().from(enrollments).where(eq(enrollments.campaignId, campaignId));
}

export async function listIdsByState(
  db: DbLike,
  campaignId: number | null,
  state: EnrollmentRow['currentState'],
): Promise<number[]> {
  const where =
    campaignId === null
      ? eq(enrollments.currentState, state)
      : and(eq(enrollments.campaignId, campaignId), eq(enrollments.currentState, state));
  const rows = await db.select({ id: enrollments.id }).from(enrollments).where(where);
  return rows.map((r) => r.id);
}

export async function stateCounts(
  db: DbLike,
  campaignId: number | null,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: enrollments.currentState, n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(campaignId === null ? undefined : eq(enrollments.campaignId, campaignId))
    .groupBy(enrollments.currentState);
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}
