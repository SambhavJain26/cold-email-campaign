import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../client';
import { enrollments, leads } from '../schema';

export type LeadRow = typeof leads.$inferSelect;

/** Lookup by normalized email (decision L: trim + lowercase, stored normalized). */
export async function getLeadByEmail(db: DbLike, email: string): Promise<LeadRow | undefined> {
  const rows = await db.select().from(leads).where(eq(leads.email, email.trim().toLowerCase()));
  return rows[0];
}

export async function getLeadById(db: DbLike, id: number): Promise<LeadRow | undefined> {
  const rows = await db.select().from(leads).where(eq(leads.id, id));
  return rows[0];
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
 * decision R). ON CONFLICT DO NOTHING - a lead created between preview and
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
 * The lead-list filter (docs/10 GET /leads) - shared by the list endpoint
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
  const conds: SQL[] = [];
  if (filter.tier !== undefined) {
    conds.push(filter.tier === 'untiered' ? isNull(leads.tier)! : eq(leads.tier, filter.tier)!);
  }
  if (filter.state !== undefined) conds.push(eq(leads.state, filter.state)!);
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

export async function updateTierByIds(
  db: DbLike,
  ids: readonly number[],
  tier: LeadTier | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(leads)
    .set({ tier })
    .where(inArray(leads.id, [...ids]))
    .returning({ id: leads.id });
  return rows.length;
}

export async function updateTierByFilter(
  db: DbLike,
  filter: LeadFilter,
  tier: LeadTier | null,
): Promise<number> {
  const where = leadFilterWhere(filter);
  // An empty filter would retier EVERY lead - refuse; that can't be intended.
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
      .where(inArray(leads.email, [...emails.slice(i, i + CHUNK)]));
    for (const r of rows) found.add(r.email);
  }
  return found;
}

export interface EligibleLead {
  id: number;
  tier: LeadTier | null;
}

/**
 * Enrollment selection (docs/06 §7): not suppressed, not already enrolled in
 * this campaign, recycle guard passes (decision Q - no prior `sent` whose
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
      sql`NOT ${leads.isSuppressed}
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
