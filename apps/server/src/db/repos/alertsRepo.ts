import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { AlertSeverity } from '@coldemail/shared';
import type { DbLike } from '../client';
import { alerts } from '../schema';

export type AlertRow = typeof alerts.$inferSelect;

export async function insertAlert(
  db: DbLike,
  kind: string,
  severity: AlertSeverity,
  payload: Record<string, unknown>,
): Promise<AlertRow> {
  const rows = await db.insert(alerts).values({ kind, severity, payload }).returning();
  return rows[0]!;
}

export async function listUnacked(db: DbLike, limit = 50): Promise<AlertRow[]> {
  return db
    .select()
    .from(alerts)
    .where(isNull(alerts.acknowledgedAt))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}

/** B6.11 GET /alerts — newest first, optional unacked filter, offset pagination. */
export async function listAlerts(
  db: DbLike,
  opts: { unacked: boolean; page: number; perPage: number },
): Promise<{ items: AlertRow[]; total: number; ackThroughId: number }> {
  const latest = await db.select({ id: sql<number>`COALESCE(max(id),0)::int` }).from(alerts);
  const ackThroughId = latest[0]?.id ?? 0;
  const where = and(
    lte(alerts.id, ackThroughId),
    opts.unacked ? isNull(alerts.acknowledgedAt) : undefined,
  );
  const items = await db
    .select()
    .from(alerts)
    .where(where)
    .orderBy(desc(alerts.createdAt))
    .limit(opts.perPage)
    .offset((opts.page - 1) * opts.perPage);
  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(where);
  return { items, total: totals[0]?.n ?? 0, ackThroughId };
}

export async function getAlert(db: DbLike, id: number): Promise<AlertRow | undefined> {
  const rows = await db.select().from(alerts).where(eq(alerts.id, id));
  return rows[0];
}

export async function acknowledgeAlert(db: DbLike, id: number, at: Date): Promise<void> {
  await db.update(alerts).set({ acknowledgedAt: at }).where(eq(alerts.id, id));
}
/** Clear the displayed feed snapshot, preserving history and newer notifications. */
export async function acknowledgeAllAlerts(db: DbLike, throughId: number, at: Date): Promise<void> {
  await db
    .update(alerts)
    .set({ acknowledgedAt: at })
    .where(and(isNull(alerts.acknowledgedAt), lte(alerts.id, throughId)));
}

/** Replace operator-visible payloads containing erased direct PII with lineage only. */
export async function redactAlertsContaining(
  db: DbLike,
  email: string,
  leadId: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE alerts
    SET payload = jsonb_build_object('lead_id', ${leadId}::integer)
    WHERE payload::text ILIKE ${`%${email}%`}
  `);
}
