import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import type { DbLike } from '../client';
import type { MailboxRow } from './mailboxesRepo';
import { countSentSince } from './eventsRepo';
import { startOfLocalDay, startOfNextLocalDay } from '../../scheduler/window';

/** Match sendOne: the last accepted step may need retry despite advanced sequence progress. */
export function sendingStep(enrollmentId: SQL | AnyColumn, currentStep: SQL | AnyColumn) {
  return sql<number>`COALESCE((SELECT recent.step_no FROM
    (SELECT step_no,occurred_at FROM events WHERE enrollment_id=${enrollmentId} AND type='sent'
      ORDER BY id DESC LIMIT 1) recent
    WHERE EXISTS (SELECT 1 FROM events bounce WHERE bounce.enrollment_id=${enrollmentId}
      AND bounce.type='soft_bounce' AND bounce.step_no=recent.step_no
      AND bounce.occurred_at>=recent.occurred_at)),${currentStep})`;
}

/** Active outstanding work through this mailbox's local day; unavailable copy stays reserved. */
export async function reservedWork(db: DbLike, before: Date, mailboxId?: number) {
  const step = sendingStep(sql`e.id`, sql`e.current_step_no`);
  const result = await db.execute(sql`
    SELECT count(*) FILTER (WHERE ${step}>1)::int AS followups,
      count(*) FILTER (WHERE ${step}=1)::int AS openers
    FROM enrollments e JOIN campaigns c ON c.id=e.campaign_id
    JOIN leads l ON l.id=e.lead_id
    WHERE c.status='active' AND e.current_state='ACTIVE'
      AND NOT l.is_erased AND NOT l.is_suppressed
      AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email=l.email)
      AND cardinality(e.review_hold_ids)=0
      AND e.next_send_at IS NOT NULL
      AND GREATEST(e.next_send_at,e.delayed_until,e.snoozed_until)<${before}
      AND ${mailboxId === undefined ? sql`e.assigned_mailbox_id IS NULL AND ${step}=1` : sql`e.assigned_mailbox_id=${mailboxId}`}`);
  const row = result.rows[0] as { followups: number; openers: number };
  return { followups: Number(row.followups), openers: Number(row.openers) };
}

export async function mailboxCapacity(db: DbLike, mailbox: MailboxRow, now: Date) {
  const sent = await countSentSince(db, mailbox.id, startOfLocalDay(now, mailbox.timezone));
  const work = await reservedWork(db, startOfNextLocalDay(now, mailbox.timezone), mailbox.id);
  const total = mailbox.resumeCap ?? mailbox.dailyCap;
  return {
    total,
    sent,
    ...work,
    openerSlots: Math.max(0, total - sent - work.followups),
    newSlots: Math.max(0, total - sent - work.followups - work.openers),
  };
}
