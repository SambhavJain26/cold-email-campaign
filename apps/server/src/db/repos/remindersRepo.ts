import { and, asc, count, desc, eq, gt, lt } from 'drizzle-orm';
import type { DbLike } from '../client';
import { campaigns, enrollments, incomingMessages, leads, operatorReminders } from '../schema';

export type ReminderRow = typeof operatorReminders.$inferSelect;
export type ReminderSource = ReminderRow['source'];
export type ReminderStatus = ReminderRow['status'];

export interface ReminderListRow extends ReminderRow {
  leadId: number;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadEmail: string;
  leadCompany: string | null;
  campaignId: number;
  replySnippet: string | null;
}

export async function listReminders(
  db: DbLike,
  input: {
    today: string;
    view: 'due_today' | 'upcoming' | 'overdue' | 'all';
    status: ReminderStatus;
    page: number;
    perPage: number;
  },
): Promise<{ items: ReminderListRow[]; total: number; openCount: number }> {
  const datePredicate =
    input.view === 'due_today'
      ? eq(operatorReminders.dueDate, input.today)
      : input.view === 'upcoming'
        ? gt(operatorReminders.dueDate, input.today)
        : input.view === 'overdue'
          ? lt(operatorReminders.dueDate, input.today)
          : undefined;
  const where = and(eq(operatorReminders.status, input.status), datePredicate);
  const [totalRow, openRow] = await Promise.all([
    db.select({ value: count() }).from(operatorReminders).where(where),
    db
      .select({ value: count() })
      .from(operatorReminders)
      .where(eq(operatorReminders.status, 'open')),
  ]);
  const items = await db
    .select({
      id: operatorReminders.id,
      enrollmentId: operatorReminders.enrollmentId,
      incomingMessageId: operatorReminders.incomingMessageId,
      dueDate: operatorReminders.dueDate,
      note: operatorReminders.note,
      source: operatorReminders.source,
      status: operatorReminders.status,
      createdAt: operatorReminders.createdAt,
      updatedAt: operatorReminders.updatedAt,
      completedAt: operatorReminders.completedAt,
      leadId: leads.id,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadEmail: leads.email,
      leadCompany: leads.company,
      campaignId: campaigns.id,
      replySnippet: incomingMessages.snippet,
    })
    .from(operatorReminders)
    .innerJoin(enrollments, eq(enrollments.id, operatorReminders.enrollmentId))
    .innerJoin(leads, eq(leads.id, enrollments.leadId))
    .innerJoin(campaigns, eq(campaigns.id, enrollments.campaignId))
    .leftJoin(incomingMessages, eq(incomingMessages.id, operatorReminders.incomingMessageId))
    .where(where)
    .orderBy(
      asc(operatorReminders.dueDate),
      desc(operatorReminders.createdAt),
      operatorReminders.id,
    )
    .limit(input.perPage)
    .offset((input.page - 1) * input.perPage);
  return {
    items,
    total: Number(totalRow[0]?.value ?? 0),
    openCount: Number(openRow[0]?.value ?? 0),
  };
}

export async function getReminder(db: DbLike, id: number): Promise<ReminderRow | undefined> {
  return (await db.select().from(operatorReminders).where(eq(operatorReminders.id, id)))[0];
}

export async function createReminder(
  db: DbLike,
  input: {
    enrollmentId: number;
    incomingMessageId?: number | null;
    dueDate: string;
    note?: string | null;
    source: ReminderSource;
    at: Date;
  },
): Promise<ReminderRow> {
  return (
    await db
      .insert(operatorReminders)
      .values({
        enrollmentId: input.enrollmentId,
        incomingMessageId: input.incomingMessageId ?? null,
        dueDate: input.dueDate,
        note: input.note ?? null,
        source: input.source,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning()
  )[0]!;
}

export async function upsertNotNowReminder(
  db: DbLike,
  input: { enrollmentId: number; incomingMessageId: number; dueDate: string; at: Date },
): Promise<void> {
  const updated = await db
    .update(operatorReminders)
    .set({
      dueDate: input.dueDate,
      status: 'open',
      completedAt: null,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(operatorReminders.incomingMessageId, input.incomingMessageId),
        eq(operatorReminders.source, 'not_now'),
      ),
    )
    .returning({ id: operatorReminders.id });
  if (updated.length === 0) {
    await db.insert(operatorReminders).values({
      enrollmentId: input.enrollmentId,
      incomingMessageId: input.incomingMessageId,
      dueDate: input.dueDate,
      source: 'not_now',
      status: 'open',
      createdAt: input.at,
      updatedAt: input.at,
    });
  }
}

export async function dismissNotNowReminder(
  db: DbLike,
  incomingMessageId: number,
  at: Date,
): Promise<void> {
  await db
    .update(operatorReminders)
    .set({ status: 'dismissed', updatedAt: at })
    .where(
      and(
        eq(operatorReminders.incomingMessageId, incomingMessageId),
        eq(operatorReminders.source, 'not_now'),
        eq(operatorReminders.status, 'open'),
      ),
    );
}

export async function patchReminder(
  db: DbLike,
  id: number,
  patch: { dueDate?: string; note?: string | null; status?: ReminderStatus },
  at: Date,
): Promise<ReminderRow | undefined> {
  const completedAt = patch.status === 'done' ? at : patch.status === 'open' ? null : undefined;
  return (
    await db
      .update(operatorReminders)
      .set({ ...patch, ...(completedAt !== undefined && { completedAt }), updatedAt: at })
      .where(eq(operatorReminders.id, id))
      .returning()
  )[0];
}
