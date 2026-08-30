import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { CurrentLeadTier, OutreachStatus } from '@coldemail/shared';
import type { DbLike } from '../client';
import {
  campaignLeadPool,
  campaignPersonalizedCopies,
  campaigns,
  enrollments,
  importRows,
  incomingMessages,
  leads,
  personalizedCopySources,
  sentMessages,
} from '../schema';

export type LeadRow = typeof leads.$inferSelect;

/** Lookup by normalized email (decision L: trim + lowercase, stored normalized). */
export async function getLeadByEmail(db: DbLike, email: string): Promise<LeadRow | undefined> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.email, email.trim().toLowerCase()), eq(leads.isErased, false)));
  return rows[0];
}

export async function leadsByEmails(
  db: DbLike,
  emails: readonly string[],
): Promise<Map<string, LeadRow>> {
  if (emails.length === 0) return new Map();
  const rows = await db
    .select()
    .from(leads)
    .where(inArray(leads.email, [...new Set(emails)]));
  return new Map(rows.map((row) => [row.email, row]));
}

export async function getLeadById(db: DbLike, id: number): Promise<LeadRow | undefined> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.isErased, false)));
  return rows[0];
}

export async function leadsByIds(db: DbLike, ids: readonly number[]): Promise<LeadRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(leads)
    .where(and(inArray(leads.id, [...ids]), eq(leads.isErased, false)));
}

export interface NewImportedLead {
  email: string; // normalized (decision L)
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  notes?: string | null;
  customFields: Record<string, string>;
  importId: number;
}

/**
 * Commit-time batch insert (docs/09 §3): tier stays NULL (untiered on import,
 * decision R). ON CONFLICT DO NOTHING — a lead created between preview and
 * commit just isn't re-inserted. Returns email → new lead id for the
 * import_rows.lead_id backfill.
 */
export async function insertImportedLeads(
  db: DbLike,
  rows: readonly NewImportedLead[],
): Promise<Map<string, number>> {
  const inserted = new Map<string, number>();
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const returned = await db
      .insert(leads)
      .values(rows.slice(i, i + CHUNK).map((r) => ({ ...r, source: 'csv_import' })))
      .onConflictDoNothing({ target: leads.email })
      .returning({ id: leads.id, email: leads.email });
    for (const r of returned) inserted.set(r.email, r.id);
  }
  return inserted;
}

/**
 * The lead-list filter (docs/10 GET /leads) — shared by the list endpoint
 * (B6.3) and bulk-tier-by-filter so "select all matching" is exact.
 */
export interface LeadFilter {
  tier?: CurrentLeadTier | 'untiered';
  state?: string;
  /** Leads with an enrollment in this campaign. */
  campaignId?: number;
  campaignScope?: 'pool' | 'enrolled' | 'both';
  /** Leads currently reserved in this campaign's available pool. */
  poolCampaignId?: number;
  /** Case-insensitive substring over email / first / last / company. */
  q?: string;
  suppressed?: boolean;
  outreachStatus?: OutreachStatus;
}

export function leadFilterWhere(filter: LeadFilter): SQL | undefined {
  const conds: SQL[] = [eq(leads.isErased, false)!];
  if (filter.tier !== undefined) {
    conds.push(filter.tier === 'untiered' ? isNull(leads.tier)! : eq(leads.tier, filter.tier)!);
  }
  // `state` is the ENROLLMENT state machine (docs/10 GET /leads — the values are
  // NEW/ACTIVE/REPLIED/BOUNCED/UNSUBSCRIBED/COMPLETED), NOT `leads.state`, which
  // is the postal/geographic column from the CSV ("Maharashtra"). Filtering the
  // wrong column made every state filter return zero rows (docs/17 §0 finding 17).
  // When a campaign is filtered too, both must hold for the SAME enrollment —
  // otherwise "REPLIED in campaign 2" would match a lead who replied in some
  // other campaign and merely happens to be enrolled in this one.
  if (filter.state !== undefined) {
    const campaignClause =
      filter.campaignId === undefined ? sql`` : sql` AND e.campaign_id = ${filter.campaignId}`;
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${enrollments} e
                  WHERE e.lead_id = ${leads.id}
                    AND e.current_state::text = ${filter.state}${campaignClause})`,
    );
  }
  if (filter.suppressed !== undefined) conds.push(eq(leads.isSuppressed, filter.suppressed)!);
  if (filter.outreachStatus !== undefined)
    conds.push(eq(leads.outreachStatus, filter.outreachStatus)!);
  if (filter.q !== undefined && filter.q !== '') {
    const like = `%${filter.q}%`;
    conds.push(
      or(
        ilike(leads.email, like),
        ilike(leads.firstName, like),
        ilike(leads.lastName, like),
        ilike(leads.company, like),
      )!,
    );
  }
  if (filter.campaignId !== undefined) {
    const enrolled = sql`EXISTS (SELECT 1 FROM ${enrollments} e
                  WHERE e.lead_id = ${leads.id} AND e.campaign_id = ${filter.campaignId})`;
    const pooled = sql`EXISTS (SELECT 1 FROM ${campaignLeadPool} p
                  WHERE p.lead_id = ${leads.id}
                    AND p.campaign_id = ${filter.campaignId}
                    AND p.status = 'available')`;
    if (filter.campaignScope === 'pool') conds.push(pooled);
    else if (filter.campaignScope === 'both') conds.push(sql`(${pooled} OR ${enrolled})`);
    else conds.push(enrolled); // omitted preserves the legacy enrolled-only contract
  }
  if (filter.poolCampaignId !== undefined) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${campaignLeadPool} p
                  WHERE p.lead_id = ${leads.id}
                    AND p.campaign_id = ${filter.poolCampaignId}
                    AND p.status = 'available')`,
    );
  }
  return conds.length === 0 ? undefined : and(...conds);
}

export interface LeadListItem {
  lead: LeadRow;
  latestEnrollment: {
    campaignId: number;
    campaignName: string;
    currentState: string;
    currentStepNo: number;
  } | null;
  poolAssignment: {
    campaignId: number;
    campaignName: string;
    status: 'available' | 'enrolled' | 'released';
  } | null;
}

/**
 * B6.3 GET /leads: filtered page + total + the untiered banner count.
 * "Latest enrollment" = the newest enrollments row per lead (highest id).
 */
export async function listLeads(
  db: DbLike,
  filter: LeadFilter,
  page: number,
  perPage: number,
): Promise<{ items: LeadListItem[]; total: number }> {
  const where = leadFilterWhere(filter);
  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(leads.id)
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const latestByLead = new Map<
    number,
    { campaignId: number; campaignName: string; currentState: string; currentStepNo: number }
  >();
  const poolByLead = new Map<
    number,
    {
      campaignId: number;
      campaignName: string;
      status: 'available' | 'enrolled' | 'released';
    }
  >();
  if (rows.length > 0) {
    const enr = await db
      .select({
        leadId: enrollments.leadId,
        campaignId: enrollments.campaignId,
        currentState: enrollments.currentState,
        currentStepNo: enrollments.currentStepNo,
        id: enrollments.id,
        campaignName: campaigns.name,
      })
      .from(enrollments)
      .innerJoin(campaigns, eq(campaigns.id, enrollments.campaignId))
      .where(
        filter.campaignId === undefined
          ? inArray(
              enrollments.leadId,
              rows.map((r) => r.id),
            )
          : and(
              inArray(
                enrollments.leadId,
                rows.map((r) => r.id),
              ),
              eq(enrollments.campaignId, filter.campaignId),
            ),
      )
      .orderBy(enrollments.leadId, enrollments.id);
    for (const e of enr) {
      // ordered by id asc — the last write per lead wins = newest enrollment
      latestByLead.set(e.leadId, {
        campaignId: e.campaignId,
        campaignName: e.campaignName,
        currentState: e.currentState,
        currentStepNo: e.currentStepNo,
      });
    }
    const poolRows = await db
      .select({
        leadId: campaignLeadPool.leadId,
        campaignId: campaignLeadPool.campaignId,
        campaignName: campaigns.name,
        status: campaignLeadPool.status,
      })
      .from(campaignLeadPool)
      .innerJoin(campaigns, eq(campaigns.id, campaignLeadPool.campaignId))
      .where(
        and(
          inArray(
            campaignLeadPool.leadId,
            rows.map((row) => row.id),
          ),
          eq(campaignLeadPool.status, 'available'),
        ),
      )
      .orderBy(campaignLeadPool.id);
    for (const pool of poolRows) poolByLead.set(pool.leadId, pool);
  }

  return {
    items: rows.map((lead) => ({
      lead,
      latestEnrollment: latestByLead.get(lead.id) ?? null,
      poolAssignment: poolByLead.get(lead.id) ?? null,
    })),
    total: totals[0]?.n ?? 0,
  };
}

/** Single-lead version of the listLeads join (detail + patch responses). */
export async function latestEnrollmentLite(
  db: DbLike,
  leadId: number,
): Promise<LeadListItem['latestEnrollment']> {
  const rows = await db
    .select({
      campaignId: enrollments.campaignId,
      campaignName: campaigns.name,
      currentState: enrollments.currentState,
      currentStepNo: enrollments.currentStepNo,
    })
    .from(enrollments)
    .innerJoin(campaigns, eq(campaigns.id, enrollments.campaignId))
    .where(eq(enrollments.leadId, leadId))
    .orderBy(sql`${enrollments.id} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/** The untiered banner number (decision R): importable leads awaiting a tier. */
export async function untieredCount(db: DbLike, filter: LeadFilter = {}): Promise<number> {
  // Nurture is an intentional hold, not work waiting to be tiered. The banner
  // therefore counts only standard-outreach leads, even when no explicit
  // outreach filter is selected. A Nurture-only view correctly reports zero.
  if (filter.outreachStatus === 'nurture') return 0;
  const where = leadFilterWhere({ ...filter, tier: 'untiered', outreachStatus: 'standard' });
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);
  return rows[0]?.n ?? 0;
}

/** B6.3 PATCH /leads/:id — tier, notes, custom_fields (custom_observation lives there). */
export async function patchLead(
  db: DbLike,
  id: number,
  patch: {
    tier?: CurrentLeadTier | null;
    outreachStatus?: OutreachStatus;
    notes?: string | null;
    customFields?: Record<string, string>;
  },
  at: Date,
): Promise<LeadRow | undefined> {
  const rows = await db
    .update(leads)
    .set({
      ...(patch.tier !== undefined && { tier: patch.tier }),
      ...(patch.outreachStatus !== undefined && {
        outreachStatus: patch.outreachStatus,
        ...(patch.outreachStatus === 'nurture' && { tier: null }),
      }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.customFields !== undefined && { customFields: patch.customFields }),
      updatedAt: at,
    })
    .where(and(eq(leads.id, id), eq(leads.isErased, false)))
    .returning();
  return rows[0];
}

export async function updateTierByIds(
  db: DbLike,
  ids: readonly number[],
  tier: CurrentLeadTier | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(leads)
    .set({ tier })
    .where(and(inArray(leads.id, [...ids]), eq(leads.isErased, false)))
    .returning({ id: leads.id });
  return rows.length;
}

export async function updateTierByFilter(
  db: DbLike,
  filter: LeadFilter,
  tier: CurrentLeadTier | null,
): Promise<number> {
  if (
    filter.tier === undefined &&
    filter.state === undefined &&
    filter.campaignId === undefined &&
    filter.poolCampaignId === undefined &&
    filter.q === undefined &&
    filter.suppressed === undefined &&
    filter.outreachStatus === undefined
  ) {
    throw new Error('bulk-tier filter matched no constraints');
  }
  const where = leadFilterWhere(filter);
  // An empty filter would retier EVERY lead — refuse; that can't be intended.
  if (where === undefined) throw new Error('bulk-tier filter matched no constraints');
  const rows = await db.update(leads).set({ tier }).where(where).returning({ id: leads.id });
  return rows.length;
}

export async function updateOutreachStatusByIds(
  db: DbLike,
  ids: readonly number[],
  status: OutreachStatus,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(leads)
    .set({ outreachStatus: status, tier: null })
    .where(and(inArray(leads.id, [...ids]), eq(leads.isErased, false)))
    .returning({ id: leads.id });
  return rows.length;
}

export async function updateOutreachStatusByFilter(
  db: DbLike,
  filter: LeadFilter,
  status: OutreachStatus,
): Promise<number> {
  const where = leadFilterWhere(filter);
  if (!where) throw new Error('bulk outreach-status filter matched no constraints');
  const rows = await db
    .update(leads)
    .set({ outreachStatus: status, tier: null })
    .where(where)
    .returning({ id: leads.id });
  return rows.length;
}

/** Which of these normalized emails already exist in leads (ingest dup check). */
export async function existingEmails(db: DbLike, emails: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 10_000;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const rows = await db
      .select({ email: leads.email })
      .from(leads)
      .where(and(inArray(leads.email, [...emails.slice(i, i + CHUNK)]), eq(leads.isErased, false)));
    for (const r of rows) found.add(r.email);
  }
  return found;
}

/** Irreversible PII anonymization while retaining non-identifying event lineage. */
export async function anonymizeLeadPii(
  db: DbLike,
  input: { leadId: number; enrollmentIds: number[]; at: Date },
): Promise<void> {
  if (input.enrollmentIds.length > 0) {
    await db
      .update(incomingMessages)
      .set({
        fromAddress: null,
        subject: null,
        snippet: null,
        bodyText: null,
        messageId: null,
        inReplyTo: null,
      })
      .where(inArray(incomingMessages.matchedEnrollmentId, input.enrollmentIds));
  }
  await db
    .update(importRows)
    .set({ raw: {}, emailNormalized: null })
    .where(eq(importRows.leadId, input.leadId));
  await db
    .update(personalizedCopySources)
    .set({ subject: '', body: '', status: 'needs_review', updatedAt: input.at })
    .where(eq(personalizedCopySources.leadId, input.leadId));
  await db
    .update(campaignPersonalizedCopies)
    .set({ subject: '', body: '', contentHash: null, updatedAt: input.at })
    .where(eq(campaignPersonalizedCopies.leadId, input.leadId));
  await db
    .update(sentMessages)
    .set({ renderedSubject: null, renderedBodyText: null, renderedBodyHtml: null })
    .where(eq(sentMessages.leadId, input.leadId));
  await db
    .update(leads)
    .set({
      email: `erased-lead-${input.leadId}@invalid.local`,
      firstName: null,
      lastName: null,
      company: null,
      website: null,
      city: null,
      state: null,
      phone: null,
      notes: null,
      customFields: {},
      tier: null,
      outreachStatus: 'standard',
      isSuppressed: false,
      suppressionReason: null,
      suppressedAt: null,
      isErased: true,
      erasedAt: input.at,
      updatedAt: input.at,
    })
    .where(eq(leads.id, input.leadId));
}

export interface EligibleLead {
  id: number;
  tier: CurrentLeadTier | null;
}

export interface RecontactStatus {
  hasReply: boolean;
  hasUndispositionedReply: boolean;
  blockedUntil: Date | null;
}

/**
 * Cross-campaign reply safety status. A human reply is review-gated until its
 * own append-only disposition exists. The latest disposition for each reply
 * controls a not-now hold; suppression remains a separate, stronger guard.
 */
export async function recontactStatusByLeadIds(
  db: DbLike,
  leadIds: readonly number[],
): Promise<Map<number, RecontactStatus>> {
  if (leadIds.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT l.id AS lead_id,
      EXISTS (
        SELECT 1 FROM events hr
        WHERE hr.lead_id = l.id AND hr.type = 'human_reply'
      ) AS has_reply,
      EXISTS (
        SELECT 1 FROM events hr
        WHERE hr.lead_id = l.id AND hr.type = 'human_reply'
          AND NOT EXISTS (
            SELECT 1 FROM events rd
            WHERE rd.type = 'reply_dispositioned'
              AND (rd.attributes->>'reply_event_id')::bigint = hr.id
          )
      ) AS has_undispositioned_reply,
      (
        SELECT max((latest.attributes->>'recontact_after')::timestamptz)
        FROM events hr
        CROSS JOIN LATERAL (
          SELECT rd.attributes
          FROM events rd
          WHERE rd.type = 'reply_dispositioned'
            AND (rd.attributes->>'reply_event_id')::bigint = hr.id
          ORDER BY rd.id DESC LIMIT 1
        ) latest
        WHERE hr.lead_id = l.id AND hr.type = 'human_reply'
          AND latest.attributes->>'disposition' = 'not_now'
      ) AS blocked_until
    FROM leads l
    WHERE l.id = ANY(${sql.param([...leadIds])}::bigint[])
  `);
  const statuses = new Map<number, RecontactStatus>();
  for (const raw of result.rows as unknown as Array<{
    lead_id: number | string;
    has_reply: boolean;
    has_undispositioned_reply: boolean;
    blocked_until: Date | string | null;
  }>) {
    statuses.set(Number(raw.lead_id), {
      hasReply: raw.has_reply,
      hasUndispositionedReply: raw.has_undispositioned_reply,
      blockedUntil: raw.blocked_until === null ? null : new Date(raw.blocked_until),
    });
  }
  return statuses;
}

/**
 * Enrollment selection (docs/06 §7): not suppressed, not already enrolled in
 * this campaign, recycle guard passes (decision Q — no prior `sent` whose
 * content_hash matches an active variant hash of the target sequence), tier ≠
 * nurture; ordered Tier A → B → C → untiered, oldest-imported first.
 */
export async function selectEligibleLeads(
  db: DbLike,
  campaignId: number,
  sequenceHashes: readonly string[],
  limit: number,
  tier?: CurrentLeadTier,
): Promise<EligibleLead[]> {
  const tierParam = tier ?? null;
  // sql.param keeps the array a single placeholder (bare interpolation would
  // expand it into a tuple, which can't cast to text[]).
  const hashGuard =
    sequenceHashes.length === 0
      ? sql`TRUE`
      : sql`NOT EXISTS (
          SELECT 1 FROM events ev
          WHERE ev.lead_id = ${leads.id} AND ev.type = 'sent'
            AND ev.attributes->>'content_hash' = ANY(${sql.param([...sequenceHashes])}::text[]))`;
  const rows = await db
    .select({ id: leads.id, tier: leads.tier })
    .from(leads)
    .where(
      sql`NOT ${leads.isSuppressed} AND NOT ${leads.isErased}
        AND ${leads.outreachStatus} = 'standard'
        AND ${leads.tier} IN ('A','B')
        AND (${tierParam}::lead_tier IS NULL OR ${leads.tier} = ${tierParam}::lead_tier)
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e
          WHERE e.lead_id = ${leads.id} AND e.campaign_id = ${campaignId})
        AND NOT EXISTS (
          SELECT 1 FROM events hr
          WHERE hr.lead_id = ${leads.id} AND hr.type = 'human_reply')
        AND ${hashGuard}`,
    )
    .orderBy(
      sql`CASE ${leads.tier} WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END`,
      leads.createdAt,
      leads.id,
    )
    .limit(limit);
  return rows.map((row) => ({ id: row.id, tier: row.tier as CurrentLeadTier }));
}

/** Leads currently in NEW/ACTIVE work for any campaign, used by pool allocation. */
export async function activeEnrollmentLeadIds(
  db: DbLike,
  leadIds: readonly number[],
  exceptCampaignId?: number,
): Promise<Set<number>> {
  if (leadIds.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT DISTINCT lead_id
      FROM enrollments
     WHERE lead_id = ANY(${sql.param([...leadIds])}::bigint[])
       AND current_state IN ('NEW','ACTIVE')
       AND (${exceptCampaignId ?? null}::bigint IS NULL OR campaign_id <> ${exceptCampaignId ?? null})`);
  return new Set(
    (result.rows as unknown as Array<{ lead_id: number | string }>).map((row) =>
      Number(row.lead_id),
    ),
  );
}

/** Global, non-specific pool allocation order: A → B → C → untiered, oldest first. */
export async function poolAllocationCandidates(
  db: DbLike,
  limit: number,
  sourceImportId?: number,
  offset = 0,
): Promise<EligibleLead[]> {
  const result = await db.execute(sql`
    SELECT l.id, l.tier
      FROM leads l
     WHERE NOT l.is_suppressed AND NOT l.is_erased
       AND l.outreach_status = 'standard'
       AND (${sourceImportId ?? null}::bigint IS NULL OR l.import_id = ${sourceImportId ?? null})
       AND NOT EXISTS (
         SELECT 1 FROM campaign_lead_pool p
          WHERE p.lead_id = l.id AND p.status = 'available'
       )
       AND NOT EXISTS (
         SELECT 1 FROM enrollments e
          WHERE e.lead_id = l.id AND e.current_state IN ('NEW','ACTIVE')
       )
       AND NOT EXISTS (
         SELECT 1 FROM events hr
          WHERE hr.lead_id = l.id AND hr.type = 'human_reply'
       )
     ORDER BY CASE l.tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
              l.created_at, l.id
     LIMIT ${limit} OFFSET ${offset}`);
  return (
    result.rows as unknown as Array<{ id: number | string; tier: CurrentLeadTier | null }>
  ).map((row) => ({ id: Number(row.id), tier: row.tier }));
}
