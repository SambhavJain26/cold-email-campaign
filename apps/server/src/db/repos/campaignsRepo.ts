import { eq, sql } from 'drizzle-orm';
import type { PersonalizationMode } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaigns, leads } from '../schema';

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

export interface RampStage {
  start_day: number;
  end_day: number;
  cap: number;
}

export interface AutoObservationConfig {
  field: string | null;
  rules: Record<string, string>;
}

export async function getCampaign(db: DbLike, id: number): Promise<CampaignRow | undefined> {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return rows[0];
}

/** Every campaign id — the rebuild-compare job preloads a shape per campaign. */
export async function listCampaignIds(db: DbLike): Promise<number[]> {
  const rows = await db.select({ id: campaigns.id }).from(campaigns).orderBy(campaigns.id);
  return rows.map((r) => r.id);
}

export function tierEffortOf(c: CampaignRow): TierEffortConfig {
  return c.tierEffortConfig as TierEffortConfig;
}

export function rampOf(c: CampaignRow): RampConfig {
  return c.rampConfig as RampConfig;
}

export function rampStagesOf(c: CampaignRow): RampStage[] {
  return c.rampStages as RampStage[];
}

export function variableOverridesOf(c: CampaignRow): Record<string, string> {
  return c.variableOverrides as Record<string, string>;
}

export function resolvedVariablesOf(c: CampaignRow): Record<string, string> {
  return c.resolvedVariables as Record<string, string>;
}

export function autoObservationConfigOf(c: CampaignRow): AutoObservationConfig {
  return {
    field: c.autoObservationField,
    rules: c.autoObservationRules as Record<string, string>,
  };
}

/** The campaign's auto_observations table, or null when unset (docs/08 §3). */
export function autoObservationsOf(c: CampaignRow): Record<string, string> | null {
  const current = autoObservationConfigOf(c).rules;
  return Object.keys(current).length > 0 ? current : (tierEffortOf(c).auto_observations ?? null);
}

export interface CampaignCounts {
  enrolledCount: number;
  contactedCount: number;
  manualOnlyCount: number;
}

/** enrolled = enrollments rows; contacted = distinct leads with ≥1 delivered (the denominator law). */
export async function campaignCounts(db: DbLike, campaignId: number): Promise<CampaignCounts> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM enrollments e JOIN ${leads} l ON l.id = e.lead_id AND NOT l.is_erased
        WHERE e.campaign_id = ${campaignId}) AS enrolled,
      (SELECT count(DISTINCT ev.lead_id)::int FROM events ev
        WHERE ev.campaign_id = ${campaignId} AND ev.type = 'delivered'
          AND EXISTS (SELECT 1 FROM ${leads} l WHERE l.id = ev.lead_id AND NOT l.is_erased)) AS contacted,
      (SELECT count(*)::int FROM enrollments e JOIN ${leads} l ON l.id = e.lead_id AND NOT l.is_erased
        WHERE e.campaign_id = ${campaignId}
          AND e.personalization_mode = 'human_written'
          AND e.current_state IN ('NEW', 'ACTIVE')) AS manual_only`);
  const row = res.rows[0] as { enrolled: number; contacted: number; manual_only: number };
  return {
    enrolledCount: row.enrolled,
    contactedCount: row.contacted,
    manualOnlyCount: row.manual_only,
  };
}

/** B6.6 GET /campaigns — with the two display counts, one grouped pass. */
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
    rampStages?: RampStage[];
    variableOverrides?: Record<string, string>;
    autoObservation?: AutoObservationConfig;
  },
): Promise<CampaignRow> {
  const rows = await db
    .insert(campaigns)
    .values({
      name: input.name,
      sequenceId: input.sequenceId,
      ...(input.tierEffortConfig !== undefined && { tierEffortConfig: input.tierEffortConfig }),
      ...(input.rampConfig !== undefined && { rampConfig: input.rampConfig }),
      ...(input.rampStages !== undefined && { rampStages: input.rampStages }),
      ...(input.variableOverrides !== undefined && { variableOverrides: input.variableOverrides }),
      ...(input.autoObservation !== undefined && {
        autoObservationField: input.autoObservation.field,
        autoObservationRules: input.autoObservation.rules,
      }),
    })
    .returning();
  return rows[0]!;
}

export async function patchCampaign(
  db: DbLike,
  id: number,
  patch: {
    name?: string;
    status?: CampaignRow['status'];
    tierEffortConfig?: TierEffortConfig;
    rampStages?: RampStage[];
    variableOverrides?: Record<string, string>;
    autoObservation?: AutoObservationConfig;
    firstActivatedAt?: Date;
  },
): Promise<CampaignRow | undefined> {
  const rows = await db
    .update(campaigns)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.tierEffortConfig !== undefined && { tierEffortConfig: patch.tierEffortConfig }),
      ...(patch.rampStages !== undefined && { rampStages: patch.rampStages }),
      ...(patch.variableOverrides !== undefined && { variableOverrides: patch.variableOverrides }),
      ...(patch.autoObservation !== undefined && {
        autoObservationField: patch.autoObservation.field,
        autoObservationRules: patch.autoObservation.rules,
      }),
      ...(patch.firstActivatedAt !== undefined && { firstActivatedAt: patch.firstActivatedAt }),
    })
    .where(eq(campaigns.id, id))
    .returning();
  return rows[0];
}

export async function deleteCampaignIfUnreferenced(
  db: DbLike,
  campaignId: number,
): Promise<{ deleted: boolean; reason?: string }> {
  const refs = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM enrollments WHERE campaign_id = ${campaignId}) AS enrollments,
      (SELECT count(*)::int FROM events WHERE campaign_id = ${campaignId}) AS events,
      (SELECT count(*)::int FROM campaigns WHERE recycled_from_campaign_id = ${campaignId}) AS recycled_by`);
  const row = refs.rows[0] as { enrollments: number; events: number; recycled_by: number };
  if (row.enrollments > 0 || row.events > 0 || row.recycled_by > 0) {
    return { deleted: false, reason: 'campaign has enrollment, event, or recycle references' };
  }
  const removed = await db
    .delete(campaigns)
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id });
  return { deleted: removed.length === 1 };
}

/**
 * B6.6 outcomes panel — the exporter's exact grouping (fixture-locked):
 * REPLIED splits by the best_reply_sentiment projection (decision M's fold).
 */
export async function outcomeCounts(
  db: DbLike,
  campaignId: number,
): Promise<Array<{ state: string; sentiment: string | null; n: number }>> {
  const res = await db.execute(sql`
    SELECT current_state AS state, best_reply_sentiment AS sentiment, count(*)::int AS n
    FROM enrollments e JOIN ${leads} l ON l.id = e.lead_id AND NOT l.is_erased
    WHERE e.campaign_id = ${campaignId} GROUP BY 1, 2`);
  return res.rows as Array<{ state: string; sentiment: string | null; n: number }>;
}

/** Every campaign sending a sequence (B6.9 steps aggregation across passes). */
export async function campaignIdsForSequence(db: DbLike, sequenceId: number): Promise<number[]> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.sequenceId, sequenceId));
  return rows.map((r) => r.id);
}

/** Tag a recycle target with its source (the "Recycled — Pass 2" label, docs/09 §6). */
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
