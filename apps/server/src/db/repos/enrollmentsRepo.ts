import { and, eq, sql } from 'drizzle-orm';
import { isTerminal } from '@coldemail/shared';
import type { DbLike } from '../client';
import { enrollments } from '../schema';
import type { EnrollmentSnapshot } from '../../domain/reducer';

export type EnrollmentRow = typeof enrollments.$inferSelect;

/**
 * Write the reducer-derived projection columns. next_send_at is cleared on
 * terminal states (nothing left to schedule); otherwise it belongs to the
 * scheduler and is left untouched here.
 */
export async function writeProjection(
  db: DbLike,
  enrollmentId: number,
  s: EnrollmentSnapshot,
): Promise<void> {
  const terminal = isTerminal(s.state);
  await db
    .update(enrollments)
    .set({
      currentState: s.state,
      currentStepNo: s.currentStepNo,
      softBounceRetries: s.softBounceRetries,
      bestReplySentiment: s.bestReplySentiment,
      meetingBooked: s.meetingBooked,
      terminalAt: s.terminalAt,
      ...(terminal ? { nextSendAt: null } : {}),
    })
    .where(eq(enrollments.id, enrollmentId));
}

export async function getById(db: DbLike, id: number): Promise<EnrollmentRow | undefined> {
  const rows = await db.select().from(enrollments).where(eq(enrollments.id, id));
  return rows[0];
}

export async function listIdsByState(
  db: DbLike,
  campaignId: number | null,
  state: EnrollmentRow['currentState'],
): Promise<number[]> {
  const where =
    campaignId === null
      ? eq(enrollments.currentState, state)
      : and(eq(enrollments.campaignId, campaignId), eq(enrollments.currentState, state));
  const rows = await db.select({ id: enrollments.id }).from(enrollments).where(where);
  return rows.map((r) => r.id);
}

export async function stateCounts(
  db: DbLike,
  campaignId: number | null,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: enrollments.currentState, n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(campaignId === null ? undefined : eq(enrollments.campaignId, campaignId))
    .groupBy(enrollments.currentState);
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}
