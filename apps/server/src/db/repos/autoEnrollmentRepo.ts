import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import {
  autoEnrollmentDays,
  autoEnrollmentRunCampaigns,
  autoEnrollmentRuns,
  autoEnrollmentState,
  campaigns,
} from '../schema';

export type AutoEnrollmentTrigger = typeof autoEnrollmentRuns.$inferSelect.trigger;
export type AutoEnrollmentRunRow = typeof autoEnrollmentRuns.$inferSelect;

export async function claimAutoEnrollmentDay(
  db: DbLike,
  localDate: string,
  now: Date,
): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO auto_enrollment_days (local_date, status, started_at, completed_at, error)
    SELECT ${localDate}::date, 'running', ${now}, NULL, NULL
     WHERE NOT EXISTS (
       SELECT 1
         FROM auto_enrollment_days
        WHERE local_date >= ${localDate}::date
     )
    ON CONFLICT (local_date) DO NOTHING
    RETURNING local_date`);
  return result.rows.length === 1;
}

export async function completeAutoEnrollmentDay(
  db: DbLike,
  localDate: string,
  now: Date,
  error?: string,
): Promise<void> {
  await db
    .update(autoEnrollmentDays)
    .set({ status: error ? 'failed' : 'completed', completedAt: now, error: error ?? null })
    .where(eq(autoEnrollmentDays.localDate, localDate));
}

export async function createAutoEnrollmentRun(
  db: DbLike,
  input: {
    trigger: AutoEnrollmentTrigger;
    localDate: string;
    capacitySnapshot: Record<string, unknown>;
    now: Date;
  },
): Promise<number> {
  const rows = await db
    .insert(autoEnrollmentRuns)
    .values({
      trigger: input.trigger,
      localDate: input.localDate,
      capacitySnapshot: input.capacitySnapshot,
      startedAt: input.now,
    })
    .returning({ id: autoEnrollmentRuns.id });
  return rows[0]!.id;
}

export async function finishAutoEnrollmentRun(
  db: DbLike,
  runId: number,
  input: { now: Date; lastServedCampaignId?: number | null; error?: string },
): Promise<void> {
  await db
    .update(autoEnrollmentRuns)
    .set({
      status: input.error ? 'failed' : 'completed',
      completedAt: input.now,
      error: input.error ?? null,
      lastServedCampaignId: input.lastServedCampaignId ?? null,
    })
    .where(eq(autoEnrollmentRuns.id, runId));
}

export async function setAutoEnrollmentRunCapacity(
  db: DbLike,
  runId: number,
  snapshot: Record<string, unknown>,
): Promise<void> {
  await db
    .update(autoEnrollmentRuns)
    .set({ capacitySnapshot: snapshot })
    .where(eq(autoEnrollmentRuns.id, runId));
}

export async function recordAutoEnrollmentCampaign(
  db: DbLike,
  input: {
    runId: number;
    campaignId: number;
    eligibleBefore: number;
    capRemaining: number;
    enrolled: number;
    skipped: Record<string, number>;
  },
): Promise<void> {
  await db.insert(autoEnrollmentRunCampaigns).values(input);
}

export async function autoEnrollmentCursor(db: DbLike): Promise<number | null> {
  const rows = await db
    .select({ id: autoEnrollmentState.lastServedCampaignId })
    .from(autoEnrollmentState)
    .where(eq(autoEnrollmentState.singleton, true));
  return rows[0]?.id ?? null;
}

export async function setAutoEnrollmentCursor(
  db: DbLike,
  campaignId: number | null,
  now: Date,
): Promise<void> {
  await db
    .update(autoEnrollmentState)
    .set({ lastServedCampaignId: campaignId, updatedAt: now })
    .where(eq(autoEnrollmentState.singleton, true));
}

export async function activeAutoEnrollmentCampaigns(db: DbLike) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'active'),
        eq(campaigns.autoEnrollEnabled, true),
        eq(campaigns.leadSelectionMode, 'pool'),
      ),
    )
    .orderBy(campaigns.id);
}

export async function lastAutoEnrollmentRunsByCampaign(
  db: DbLike,
  campaignIds: readonly number[],
): Promise<Map<number, AutoEnrollmentRunRow & { enrolled: number }>> {
  if (campaignIds.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT DISTINCT ON (arc.campaign_id)
           ar.*, arc.campaign_id, arc.enrolled
      FROM auto_enrollment_run_campaigns arc
      JOIN auto_enrollment_runs ar ON ar.id = arc.run_id
     WHERE arc.campaign_id = ANY(${sql.param([...campaignIds])}::bigint[])
     ORDER BY arc.campaign_id, ar.id DESC`);
  const out = new Map<number, AutoEnrollmentRunRow & { enrolled: number }>();
  for (const raw of result.rows as unknown as Array<Record<string, unknown>>) {
    out.set(Number(raw.campaign_id), {
      id: Number(raw.id),
      trigger: raw.trigger as AutoEnrollmentTrigger,
      localDate: String(raw.local_date),
      status: raw.status as AutoEnrollmentRunRow['status'],
      capacitySnapshot: raw.capacity_snapshot as Record<string, unknown>,
      lastServedCampaignId:
        raw.last_served_campaign_id === null ? null : Number(raw.last_served_campaign_id),
      startedAt: new Date(raw.started_at as string | Date),
      completedAt: raw.completed_at === null ? null : new Date(raw.completed_at as string | Date),
      error: raw.error === null ? null : String(raw.error),
      enrolled: Number(raw.enrolled),
    });
  }
  return out;
}

export async function listAutoEnrollmentRuns(
  db: DbLike,
  campaignId: number,
  page: number,
  perPage: number,
): Promise<{ items: Array<AutoEnrollmentRunRow & { enrolled: number }>; total: number }> {
  const rows = await db
    .select({ run: autoEnrollmentRuns, enrolled: autoEnrollmentRunCampaigns.enrolled })
    .from(autoEnrollmentRunCampaigns)
    .innerJoin(autoEnrollmentRuns, eq(autoEnrollmentRuns.id, autoEnrollmentRunCampaigns.runId))
    .where(eq(autoEnrollmentRunCampaigns.campaignId, campaignId))
    .orderBy(desc(autoEnrollmentRuns.id))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(autoEnrollmentRunCampaigns)
    .where(eq(autoEnrollmentRunCampaigns.campaignId, campaignId));
  return {
    items: rows.map((row) => ({ ...row.run, enrolled: row.enrolled })),
    total: totals[0]?.n ?? 0,
  };
}
