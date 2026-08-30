import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import {
  campaignRecycleSources,
  campaigns,
  enrollments,
  leads,
  recycleEnrollmentSources,
} from '../schema';
import type { LeadTier, OutreachStatus } from '@coldemail/shared';

export interface SourceEnrollmentCandidate {
  sourceCampaignId: number;
  sourceEnrollmentId: number;
  leadId: number;
  email: string;
  tier: LeadTier | null;
  outreachStatus: OutreachStatus;
  isSuppressed: boolean;
  isErased: boolean;
  completedAt: Date;
}

export async function completedSourceEnrollments(
  db: DbLike,
  sourceCampaignIds: readonly number[],
): Promise<SourceEnrollmentCandidate[]> {
  if (sourceCampaignIds.length === 0) return [];
  const rows = await db
    .select({
      sourceCampaignId: enrollments.campaignId,
      sourceEnrollmentId: enrollments.id,
      leadId: enrollments.leadId,
      email: leads.email,
      tier: leads.tier,
      outreachStatus: leads.outreachStatus,
      isSuppressed: leads.isSuppressed,
      isErased: leads.isErased,
      completedAt: enrollments.terminalAt,
    })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(
      and(
        inArray(enrollments.campaignId, [...sourceCampaignIds]),
        eq(enrollments.currentState, 'COMPLETED'),
        isNotNull(enrollments.terminalAt),
      ),
    );
  return rows.map((row) => ({ ...row, completedAt: row.completedAt! }));
}

export async function existingCampaignIds(
  db: DbLike,
  ids: readonly number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(inArray(campaigns.id, [...ids]));
  return new Set(rows.map((row) => row.id));
}

export async function lockRecycleTarget(db: DbLike, targetCampaignId: number): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT id FROM campaigns WHERE id = ${targetCampaignId} FOR UPDATE`,
  );
  return result.rows.length > 0;
}

export async function setLegacyRecycleSource(
  db: DbLike,
  targetCampaignId: number,
  sourceCampaignId: number | null,
): Promise<void> {
  await db
    .update(campaigns)
    .set({ recycledFromCampaignId: sourceCampaignId })
    .where(eq(campaigns.id, targetCampaignId));
}

export interface RecycleSourceSummary {
  campaignId: number;
  name: string;
  contributedLeads: number;
}

export async function recycleSourcesByTargetIds(
  db: DbLike,
  targetCampaignIds: readonly number[],
): Promise<Map<number, RecycleSourceSummary[]>> {
  if (targetCampaignIds.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT crs.target_campaign_id, crs.source_campaign_id, c.name,
           count(DISTINCT res.target_enrollment_id)::int contributed_leads
    FROM campaign_recycle_sources crs
    JOIN campaigns c ON c.id = crs.source_campaign_id
    LEFT JOIN recycle_enrollment_sources res
      ON res.source_campaign_id = crs.source_campaign_id
     AND EXISTS (
       SELECT 1 FROM enrollments target_enrollment
       WHERE target_enrollment.id = res.target_enrollment_id
         AND target_enrollment.campaign_id = crs.target_campaign_id)
    WHERE crs.target_campaign_id = ANY(${sql.param([...targetCampaignIds])}::bigint[])
    GROUP BY crs.target_campaign_id, crs.source_campaign_id, c.name
    ORDER BY crs.target_campaign_id, crs.source_campaign_id`);
  const out = new Map<number, RecycleSourceSummary[]>();
  for (const raw of result.rows as Array<{
    target_campaign_id: number | string;
    source_campaign_id: number | string;
    name: string;
    contributed_leads: number;
  }>) {
    const targetId = Number(raw.target_campaign_id);
    const list = out.get(targetId) ?? [];
    list.push({
      campaignId: Number(raw.source_campaign_id),
      name: raw.name,
      contributedLeads: Number(raw.contributed_leads),
    });
    out.set(targetId, list);
  }
  return out;
}

export async function addCampaignRecycleSources(
  db: DbLike,
  targetCampaignId: number,
  sourceCampaignIds: readonly number[],
  selectedAt: Date,
): Promise<void> {
  if (sourceCampaignIds.length === 0) return;
  await db
    .insert(campaignRecycleSources)
    .values(
      sourceCampaignIds.map((sourceCampaignId) => ({
        targetCampaignId,
        sourceCampaignId,
        selectedAt,
      })),
    )
    .onConflictDoNothing();
}

export async function addRecycleEnrollmentSources(
  db: DbLike,
  rows: ReadonlyArray<{
    targetEnrollmentId: number;
    sourceCampaignId: number;
    sourceEnrollmentId: number;
    createdAt: Date;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(recycleEnrollmentSources)
    .values([...rows])
    .onConflictDoNothing();
}
