import { desc, eq, isNull } from 'drizzle-orm';
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

export async function acknowledgeAlert(db: DbLike, id: number, at: Date): Promise<void> {
  await db.update(alerts).set({ acknowledgedAt: at }).where(eq(alerts.id, id));
}
