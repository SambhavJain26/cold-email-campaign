// Events repo: the only place SQL touches the events table.
// Append-only — there is deliberately no update/delete here.
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { events } from '../schema';
import { parseDomainEvent, type DomainEvent } from '../../domain/events';

type EventRow = typeof events.$inferSelect;

/** DomainEvent → insert row (snake_case columns handled by drizzle defs). */
function toRow(e: DomainEvent): typeof events.$inferInsert {
  return {
    type: e.type,
    occurredAt: e.occurredAt,
    leadId: e.leadId,
    enrollmentId: 'enrollmentId' in e ? (e.enrollmentId ?? null) : null,
    campaignId: 'campaignId' in e ? (e.campaignId ?? null) : null,
    stepNo: 'stepNo' in e ? (e.stepNo ?? null) : null,
    mailboxId: 'mailboxId' in e ? (e.mailboxId ?? null) : null,
    messageId: 'messageId' in e ? (e.messageId ?? null) : null,
    sentiment: 'sentiment' in e ? (e.sentiment ?? null) : null,
    source: 'source' in e ? e.source : null,
    reason: 'reason' in e ? (e.reason ?? null) : null,
    attributes: 'attributes' in e ? (e.attributes ?? {}) : {},
  };
}

/** DB row → validated DomainEvent (null → undefined at the boundary). */
export function rowToDomainEvent(r: EventRow): DomainEvent {
  return parseDomainEvent({
    id: r.id,
    type: r.type,
    occurredAt: r.occurredAt,
    leadId: r.leadId,
    enrollmentId: r.enrollmentId ?? undefined,
    campaignId: r.campaignId ?? undefined,
    stepNo: r.stepNo ?? undefined,
    mailboxId: r.mailboxId ?? undefined,
    messageId: r.messageId ?? undefined,
    sentiment: r.sentiment,
    source: r.source ?? undefined,
    reason: r.reason ?? undefined,
    attributes: r.attributes,
  });
}

export async function insertEvents(db: DbLike, evs: readonly DomainEvent[]): Promise<number[]> {
  if (evs.length === 0) return [];
  const rows = await db.insert(events).values(evs.map(toRow)).returning({ id: events.id });
  return rows.map((r) => r.id);
}

/** Sends from a mailbox since an instant — the cap counter (docs/06 §1 B). */
export async function countSentSince(db: DbLike, mailboxId: number, since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(eq(events.type, 'sent'), eq(events.mailboxId, mailboxId), gte(events.occurredAt, since)),
    );
  return rows[0]?.n ?? 0;
}

/** Any bounce for (enrollment, step) at/after `since` — confirm-delivery's veto (decision N). */
export async function hasBounceSince(
  db: DbLike,
  enrollmentId: number,
  stepNo: number,
  since: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.enrollmentId, enrollmentId),
        eq(events.stepNo, stepNo),
        inArray(events.type, ['soft_bounce', 'hard_bounce']),
        gte(events.occurredAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Latest sent event of an enrollment — soft-retry detection + threading anchor. */
export async function lastSentEvent(
  db: DbLike,
  enrollmentId: number,
): Promise<{ stepNo: number; occurredAt: Date; messageId: string } | null> {
  const rows = await db
    .select({ stepNo: events.stepNo, occurredAt: events.occurredAt, messageId: events.messageId })
    .from(events)
    .where(and(eq(events.enrollmentId, enrollmentId), eq(events.type, 'sent')))
    .orderBy(desc(events.id))
    .limit(1);
  const r = rows[0];
  return r ? { stepNo: r.stepNo!, occurredAt: r.occurredAt, messageId: r.messageId! } : null;
}

/** Soft bounce for (enrollment, step) after an instant — is this send a retry? */
export async function hasSoftBounceAfter(
  db: DbLike,
  enrollmentId: number,
  stepNo: number,
  after: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.enrollmentId, enrollmentId),
        eq(events.stepNo, stepNo),
        eq(events.type, 'soft_bounce'),
        gte(events.occurredAt, after),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listByEnrollment(db: DbLike, enrollmentId: number): Promise<DomainEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.enrollmentId, enrollmentId))
    .orderBy(asc(events.id));
  return rows.map(rowToDomainEvent);
}

export async function listByEnrollments(
  db: DbLike,
  enrollmentIds: readonly number[],
): Promise<Map<number, DomainEvent[]>> {
  const out = new Map<number, DomainEvent[]>();
  if (enrollmentIds.length === 0) return out;
  const rows = await db
    .select()
    .from(events)
    .where(inArray(events.enrollmentId, [...enrollmentIds]))
    .orderBy(asc(events.id));
  for (const r of rows) {
    const e = rowToDomainEvent(r);
    const key = r.enrollmentId!;
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  return out;
}
