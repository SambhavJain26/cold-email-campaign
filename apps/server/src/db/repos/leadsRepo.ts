import { sql } from 'drizzle-orm';
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../client';
import { leads } from '../schema';

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
