import { and, asc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { isTerminal, type LeadTier, type PersonalizationMode } from '@coldemail/shared';
import type { DbLike } from '../client';
import { enrollments, leads } from '../schema';
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

/** Scheduling columns the reducer can't derive (docs/02 §3) - eventStore-only writer. */
export async function patchScheduling(
  db: DbLike,
  enrollmentId: number,
  patch: { nextSendAt?: Date | null; assignedMailboxId?: number; snoozedUntil?: Date | null },
): Promise<void> {
  const set: Partial<typeof enrollments.$inferInsert> = {};
  if (patch.nextSendAt !== undefined) set.nextSendAt = patch.nextSendAt;
  if (patch.assignedMailboxId !== undefined) set.assignedMailboxId = patch.assignedMailboxId;
  if (patch.snoozedUntil !== undefined) set.snoozedUntil = patch.snoozedUntil;
  if (Object.keys(set).length === 0) return;
  await db.update(enrollments).set(set).where(eq(enrollments.id, enrollmentId));
}

/** A due ACTIVE enrollment joined with what sendOne needs from the lead. */
export interface DueEnrollment {
  id: number;
  leadId: number;
  campaignId: number;
  currentStepNo: number;
  assignedMailboxId: number | null;
  nextSendAt: Date;
  leadEmail: string;
  leadFirstName: string | null;
  leadCompany: string | null;
  leadState: string | null;
}

/**
 * Due work, oldest-first (docs/06 §1 C): ACTIVE, next_send_at <= now, not
 * snoozed. Oldest-first ordering + budgets IS the catch-up mechanism.
 * Suppressed leads are excluded - send-time is one of suppression's four
 * enforcement layers.
 */
export async function listDue(db: DbLike, now: Date): Promise<DueEnrollment[]> {
  const rows = await db
    .select({
      id: enrollments.id,
      leadId: enrollments.leadId,
      campaignId: enrollments.campaignId,
      currentStepNo: enrollments.currentStepNo,
      assignedMailboxId: enrollments.assignedMailboxId,
      nextSendAt: enrollments.nextSendAt,
      leadEmail: leads.email,
      leadFirstName: leads.firstName,
      leadCompany: leads.company,
      leadState: leads.state,
    })
    .from(enrollments)
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .where(
      and(
        eq(enrollments.currentState, 'ACTIVE'),
        lte(enrollments.nextSendAt, now),
        or(isNull(enrollments.snoozedUntil), lte(enrollments.snoozedUntil, now)),
        eq(leads.isSuppressed, false),
      ),
    )
    .orderBy(asc(enrollments.nextSendAt), asc(enrollments.id));
  return rows.map((r) => ({ ...r, nextSendAt: r.nextSendAt! }));
}

/** Campaigns that still have ACTIVE enrollments - the tick's completion sweep set. */
export async function activeCampaignIds(db: DbLike): Promise<number[]> {
  const rows = await db
    .selectDistinct({ campaignId: enrollments.campaignId })
    .from(enrollments)
    .where(eq(enrollments.currentState, 'ACTIVE'));
  return rows.map((r) => r.campaignId);
}

/**
 * Redistribution on a dead mailbox (docs/06 §6): enrollments that have NOT
 * yet received step 1 lose their assignment → next tick's rotation reassigns.
 * Mid-thread enrollments keep theirs (rerouting breaks threading).
 */
export async function redistributeUnstarted(db: DbLike, mailboxId: number): Promise<number> {
  const rows = await db
    .update(enrollments)
    .set({ assignedMailboxId: null })
    .where(
      and(
        eq(enrollments.assignedMailboxId, mailboxId),
        eq(enrollments.currentState, 'ACTIVE'),
        sql`NOT EXISTS (SELECT 1 FROM events ev WHERE ev.enrollment_id = ${enrollments.id} AND ev.type = 'sent')`,
      ),
    )
    .returning({ id: enrollments.id });
  return rows.length;
}

/** Follow-ups still owed before `before` (capacity formula, docs/06 §7). */
export async function countFollowupsDue(db: DbLike, before: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.currentState, 'ACTIVE'),
        isNotNull(enrollments.assignedMailboxId), // assigned at first send ⇒ ≥1 sent
        lt(enrollments.nextSendAt, before),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Enrollments created today (ramp cap accounting). */
export async function countEnrolledSince(
  db: DbLike,
  campaignId: number,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(eq(enrollments.campaignId, campaignId), gte(enrollments.enrolledAt, since)));
  return rows[0]?.n ?? 0;
}

export interface NewEnrollment {
  leadId: number;
  campaignId: number;
  enrolledTier: LeadTier | null;
  personalizationMode: PersonalizationMode;
  enrolledAt: Date;
}

export async function insertEnrollments(
  db: DbLike,
  rows: readonly NewEnrollment[],
): Promise<number[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(enrollments)
    .values(rows.map((r) => ({ ...r, currentState: 'NEW' as const })))
    .returning({ id: enrollments.id });
  return inserted.map((r) => r.id);
}

export async function getById(db: DbLike, id: number): Promise<EnrollmentRow | undefined> {
  const rows = await db.select().from(enrollments).where(eq(enrollments.id, id));
  return rows[0];
}

export async function listAll(db: DbLike, campaignId: number | null): Promise<EnrollmentRow[]> {
  return campaignId === null
    ? db.select().from(enrollments)
    : db.select().from(enrollments).where(eq(enrollments.campaignId, campaignId));
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
