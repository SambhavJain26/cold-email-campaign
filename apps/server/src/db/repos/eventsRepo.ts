// Events repo: the only place SQL touches the events table.
// Append-only - there is deliberately no update/delete here.
import { asc, eq, inArray } from 'drizzle-orm';
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
