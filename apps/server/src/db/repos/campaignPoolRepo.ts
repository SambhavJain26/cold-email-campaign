import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaignLeadPool, leads } from '../schema';

export type CampaignPoolRow = typeof campaignLeadPool.$inferSelect;
export type CampaignPoolStatus = CampaignPoolRow['status'];

export interface CampaignPoolSummary {
  total: number;
  available: number;
  enrolled: number;
  released: number;
  temporarilyIneligible: number;
  sourceImports: number;
}

export async function poolSummary(db: DbLike, campaignId: number): Promise<CampaignPoolSummary> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'available')::int AS available,
           count(*) FILTER (WHERE status = 'enrolled')::int AS enrolled,
           count(*) FILTER (WHERE status = 'released')::int AS released,
           count(*) FILTER (
             WHERE status = 'available' AND last_eligibility_reason IS NOT NULL
           )::int AS temporarily_ineligible,
           count(DISTINCT source_import_id) FILTER (WHERE source_import_id IS NOT NULL)::int
             AS source_imports
      FROM campaign_lead_pool
     WHERE campaign_id = ${campaignId}`);
  const row = result.rows[0] as Record<string, number>;
  return {
    total: row.total ?? 0,
    available: row.available ?? 0,
    enrolled: row.enrolled ?? 0,
    released: row.released ?? 0,
    temporarilyIneligible: row.temporarily_ineligible ?? 0,
    sourceImports: row.source_imports ?? 0,
  };
}

export interface CampaignPoolListItem extends CampaignPoolRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  tier: LeadTier | null;
}

export async function listCampaignPool(
  db: DbLike,
  campaignId: number,
  page: number,
  perPage: number,
  status?: CampaignPoolStatus,
): Promise<{ items: CampaignPoolListItem[]; total: number }> {
  const where = status
    ? and(eq(campaignLeadPool.campaignId, campaignId), eq(campaignLeadPool.status, status))
    : eq(campaignLeadPool.campaignId, campaignId);
  const items = await db
    .select({
      pool: campaignLeadPool,
      email: leads.email,
      firstName: leads.firstName,
      lastName: leads.lastName,
      company: leads.company,
      tier: leads.tier,
    })
    .from(campaignLeadPool)
    .innerJoin(leads, eq(leads.id, campaignLeadPool.leadId))
    .where(where)
    .orderBy(asc(campaignLeadPool.allocationOrder), asc(campaignLeadPool.id))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignLeadPool)
    .where(where);
  return {
    items: items.map((item) => ({ ...item.pool, ...item })),
    total: totals[0]?.n ?? 0,
  };
}

export async function nextPoolAllocationOrder(db: DbLike): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COALESCE(max(allocation_order), 0)::bigint` })
    .from(campaignLeadPool);
  return Number(rows[0]?.n ?? 0) + 1;
}

export async function allocatePoolLeads(
  db: DbLike,
  input: {
    campaignId: number;
    leadIds: readonly number[];
    sourceImportId?: number;
    now: Date;
  },
): Promise<number> {
  if (input.leadIds.length === 0) return 0;
  let order = await nextPoolAllocationOrder(db);
  for (const leadId of input.leadIds) {
    await db.execute(sql`
      INSERT INTO campaign_lead_pool
        (campaign_id, lead_id, source_import_id, allocation_order, status, allocated_at,
         enrollment_id, enrolled_at, released_at, last_eligibility_reason, last_checked_at)
      VALUES (${input.campaignId}, ${leadId}, ${input.sourceImportId ?? null}, ${order++},
              'available', ${input.now}, NULL, NULL, NULL, NULL, NULL)
      ON CONFLICT (campaign_id, lead_id) DO UPDATE
        SET source_import_id = EXCLUDED.source_import_id,
            allocation_order = EXCLUDED.allocation_order,
            status = 'available',
            allocated_at = EXCLUDED.allocated_at,
            enrollment_id = NULL,
            enrolled_at = NULL,
            released_at = NULL,
            last_eligibility_reason = NULL,
            last_checked_at = NULL
      WHERE campaign_lead_pool.status = 'released'`);
  }
  return input.leadIds.length;
}

export async function availablePoolLeads(
  db: DbLike,
  campaignId: number,
  limit: number,
): Promise<Array<{ poolId: number; leadId: number; tier: LeadTier | null }>> {
  const rows = await db
    .select({ poolId: campaignLeadPool.id, leadId: leads.id, tier: leads.tier })
    .from(campaignLeadPool)
    .innerJoin(leads, eq(leads.id, campaignLeadPool.leadId))
    .where(
      and(eq(campaignLeadPool.campaignId, campaignId), eq(campaignLeadPool.status, 'available')),
    )
    .orderBy(
      sql`CASE ${leads.tier} WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END`,
      asc(campaignLeadPool.allocationOrder),
      asc(campaignLeadPool.id),
    )
    .limit(limit);
  return rows;
}

export async function markPoolEnrolled(
  db: DbLike,
  rows: ReadonlyArray<{ poolId: number; enrollmentId: number }>,
  now: Date,
): Promise<void> {
  for (const row of rows) {
    const changed = await db
      .update(campaignLeadPool)
      .set({
        status: 'enrolled',
        enrollmentId: row.enrollmentId,
        enrolledAt: now,
        lastEligibilityReason: null,
        lastCheckedAt: now,
      })
      .where(and(eq(campaignLeadPool.id, row.poolId), eq(campaignLeadPool.status, 'available')))
      .returning({ id: campaignLeadPool.id });
    if (changed.length !== 1) {
      throw new Error(`campaign pool row ${row.poolId} is no longer available`);
    }
  }
}

export async function markPoolEligibility(
  db: DbLike,
  poolId: number,
  reason: string | null,
  now: Date,
): Promise<void> {
  await db
    .update(campaignLeadPool)
    .set({ lastEligibilityReason: reason, lastCheckedAt: now })
    .where(eq(campaignLeadPool.id, poolId));
}

export async function releasePoolLeads(
  db: DbLike,
  campaignId: number,
  leadIds: readonly number[],
  now: Date,
): Promise<number> {
  if (leadIds.length === 0) return 0;
  const rows = await db
    .update(campaignLeadPool)
    .set({ status: 'released', releasedAt: now, lastEligibilityReason: null })
    .where(
      and(
        eq(campaignLeadPool.campaignId, campaignId),
        eq(campaignLeadPool.status, 'available'),
        inArray(campaignLeadPool.leadId, [...leadIds]),
      ),
    )
    .returning({ id: campaignLeadPool.id });
  return rows.length;
}

export async function availablePoolLeadIds(
  db: DbLike,
  campaignId: number,
  leadIds: readonly number[],
): Promise<number[]> {
  if (leadIds.length === 0) return [];
  const rows = await db
    .select({ leadId: campaignLeadPool.leadId })
    .from(campaignLeadPool)
    .where(
      and(
        eq(campaignLeadPool.campaignId, campaignId),
        eq(campaignLeadPool.status, 'available'),
        inArray(campaignLeadPool.leadId, [...leadIds]),
      ),
    );
  return rows.map((row) => row.leadId);
}

export async function availablePoolRowsForLeadIds(
  db: DbLike,
  campaignId: number,
  leadIds: readonly number[],
): Promise<Map<number, number>> {
  if (leadIds.length === 0) return new Map();
  const rows = await db
    .select({ leadId: campaignLeadPool.leadId, poolId: campaignLeadPool.id })
    .from(campaignLeadPool)
    .where(
      and(
        eq(campaignLeadPool.campaignId, campaignId),
        eq(campaignLeadPool.status, 'available'),
        inArray(campaignLeadPool.leadId, [...leadIds]),
      ),
    );
  return new Map(rows.map((row) => [row.leadId, row.poolId]));
}

export async function setCampaignPoolMode(db: DbLike, campaignId: number): Promise<void> {
  await db.execute(sql`
    UPDATE campaigns SET lead_selection_mode = 'pool'
     WHERE id = ${campaignId} AND lead_selection_mode = 'global'`);
}

export async function activePoolCampaignForLeads(
  db: DbLike,
  leadIds: readonly number[],
): Promise<Map<number, number>> {
  if (leadIds.length === 0) return new Map();
  const rows = await db
    .select({ leadId: campaignLeadPool.leadId, campaignId: campaignLeadPool.campaignId })
    .from(campaignLeadPool)
    .where(
      and(eq(campaignLeadPool.status, 'available'), inArray(campaignLeadPool.leadId, [...leadIds])),
    );
  return new Map(rows.map((row) => [row.leadId, row.campaignId]));
}
