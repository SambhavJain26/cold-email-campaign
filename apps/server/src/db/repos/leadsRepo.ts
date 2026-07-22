import { eq, inArray, sql } from 'drizzle-orm';
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../client';
import { leads } from '../schema';

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
