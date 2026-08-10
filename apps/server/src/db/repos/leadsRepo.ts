import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaigns, enrollments, importRows, incomingMessages, leads } from '../schema';

export type LeadRow = typeof leads.$inferSelect;

/** Lookup by normalized email (decision L: trim + lowercase, stored normalized). */
export async function getLeadByEmail(db: DbLike, email: string): Promise<LeadRow | undefined> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.email, email.trim().toLowerCase()), eq(leads.isErased, false)));
  return rows[0];
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
  tier?: LeadTier | 'untiered';
  state?: string;
  /** Leads with an enrollment in this campaign. */
  campaignId?: number;
  /** Case-insensitive substring over email / first / last / company. */
  q?: string;
  suppressed?: boolean;
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
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${enrollments} e
                  WHERE e.lead_id = ${leads.id} AND e.campaign_id = ${filter.campaignId})`,
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
  }

  return {
    items: rows.map((lead) => ({ lead, latestEnrollment: latestByLead.get(lead.id) ?? null })),
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
export async function untieredCount(db: DbLike): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(isNull(leads.tier), eq(leads.isSuppressed, false), eq(leads.isErased, false)));
  return rows[0]?.n ?? 0;
}

/** B6.3 PATCH /leads/:id — tier, notes, custom_fields (custom_observation lives there). */
export async function patchLead(
  db: DbLike,
  id: number,
  patch: {
    tier?: LeadTier | null;
    notes?: string | null;
    customFields?: Record<string, string>;
  },
  at: Date,
): Promise<LeadRow | undefined> {
  const rows = await db
    .update(leads)
    .set({
      ...(patch.tier !== undefined && { tier: patch.tier }),
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
  tier: LeadTier | null,
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
  tier: LeadTier | null,
): Promise<number> {
  if (
    filter.tier === undefined &&
    filter.state === undefined &&
    filter.campaignId === undefined &&
    filter.q === undefined &&
    filter.suppressed === undefined
  ) {
    throw new Error('bulk-tier filter matched no constraints');
  }
  const where = leadFilterWhere(filter);
  // An empty filter would retier EVERY lead — refuse; that can't be intended.
  if (where === undefined) throw new Error('bulk-tier filter matched no constraints');
  const rows = await db.update(leads).set({ tier }).where(where).returning({ id: leads.id });
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
  tier: LeadTier | null;
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
  tier?: LeadTier,
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
        AND ${leads.tier} IS DISTINCT FROM 'nurture'
        AND (${tierParam}::lead_tier IS NULL OR ${leads.tier} = ${tierParam}::lead_tier)
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e
          WHERE e.lead_id = ${leads.id} AND e.campaign_id = ${campaignId})
        AND ${hashGuard}`,
    )
    .orderBy(
      sql`CASE ${leads.tier} WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END`,
      leads.createdAt,
      leads.id,
    )
    .limit(limit);
  return rows;
}
