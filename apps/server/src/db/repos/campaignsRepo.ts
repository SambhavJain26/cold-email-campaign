import { eq, sql } from 'drizzle-orm';
import type { PersonalizationMode } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaigns } from '../schema';

export type CampaignRow = typeof campaigns.$inferSelect;

export interface TierEffortConfig {
  A: PersonalizationMode;
  B: PersonalizationMode;
  C: PersonalizationMode;
  /** Market-keyed {{custom_observation}} segment rule (docs/08 §3), 'default' key incl. */
  auto_observations?: Record<string, string>;
}

export interface RampConfig {
  ramp_days: number;
  ramp_daily_enroll_cap: number;
}

export async function getCampaign(db: DbLike, id: number): Promise<CampaignRow | undefined> {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return rows[0];
}

export function tierEffortOf(c: CampaignRow): TierEffortConfig {
  return c.tierEffortConfig as TierEffortConfig;
}

export function rampOf(c: CampaignRow): RampConfig {
  return c.rampConfig as RampConfig;
}

/** The campaign's auto_observations table, or null when unset (docs/08 §3). */
export function autoObservationsOf(c: CampaignRow): Record<string, string> | null {
  return tierEffortOf(c).auto_observations ?? null;
}

export interface CampaignCounts {
  enrolledCount: number;
  contactedCount: number;
}

/** enrolled = enrollments rows; contacted = distinct leads with ≥1 delivered (the denominator law). */
export async function campaignCounts(db: DbLike, campaignId: number): Promise<CampaignCounts> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM enrollments e WHERE e.campaign_id = ${campaignId}) AS enrolled,
      (SELECT count(DISTINCT ev.lead_id)::int FROM events ev
        WHERE ev.campaign_id = ${campaignId} AND ev.type = 'delivered') AS contacted`);
  const row = res.rows[0] as { enrolled: number; contacted: number };
  return { enrolledCount: row.enrolled, contactedCount: row.contacted };
}

/** B6.6 GET /campaigns - with the two display counts, one grouped pass. */
export async function listCampaigns(
  db: DbLike,
  page: number,
  perPage: number,
): Promise<{ items: Array<{ campaign: CampaignRow; counts: CampaignCounts }>; total: number }> {
  const rows = await db
    .select()
    .from(campaigns)
    .orderBy(campaigns.id)
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(campaigns);
  const items = [];
  for (const campaign of rows) {
    items.push({ campaign, counts: await campaignCounts(db, campaign.id) });
  }
  return { items, total: totals[0]?.n ?? 0 };
}

export async function createCampaign(
  db: DbLike,
  input: {
    name: string;
    sequenceId: number;
    tierEffortConfig?: TierEffortConfig;
    rampConfig?: RampConfig;
  },
): Promise<CampaignRow> {
  const rows = await db
    .insert(campaigns)
    .values({
      name: input.name,
      sequenceId: input.sequenceId,
      ...(input.tierEffortConfig !== undefined && { tierEffortConfig: input.tierEffortConfig }),
      ...(input.rampConfig !== undefined && { rampConfig: input.rampConfig }),
    })
    .returning();
  return rows[0]!;
}

export async function patchCampaign(
  db: DbLike,
  id: number,
  patch: { name?: string; status?: CampaignRow['status'] },
): Promise<CampaignRow | undefined> {
  const rows = await db
    .update(campaigns)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.status !== undefined && { status: patch.status }),
    })
    .where(eq(campaigns.id, id))
    .returning();
  return rows[0];
}

/**
 * B6.6 outcomes panel - the exporter's exact grouping (fixture-locked):
 * REPLIED splits by the best_reply_sentiment projection (decision M's fold).
 */
export async function outcomeCounts(
  db: DbLike,
  campaignId: number,
): Promise<Array<{ state: string; sentiment: string | null; n: number }>> {
  const res = await db.execute(sql`
    SELECT current_state AS state, best_reply_sentiment AS sentiment, count(*)::int AS n
    FROM enrollments WHERE campaign_id = ${campaignId} GROUP BY 1, 2`);
  return res.rows as Array<{ state: string; sentiment: string | null; n: number }>;
}

/** Tag a recycle target with its source (the "Recycled - Pass 2" label, docs/09 §6). */
export async function setRecycledFrom(
  db: DbLike,
  campaignId: number,
  sourceCampaignId: number,
): Promise<void> {
  await db
    .update(campaigns)
    .set({ recycledFromCampaignId: sourceCampaignId })
    .where(eq(campaigns.id, campaignId));
}
