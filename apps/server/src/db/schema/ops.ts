// Mirrors 0006_ops.up.sql 1:1 (docs/03 §3).
import {
  bigint,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { alertSeverityEnum } from './enums';
import { enrollments } from './core';
import { incomingMessages } from './transport';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const alerts = pgTable(
  'alerts',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    kind: text('kind').notNull(),
    severity: alertSeverityEnum('severity').notNull(),
    payload: jsonb('payload').notNull().default({}),
    acknowledgedAt: tz('acknowledged_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('alerts_unacked')
      .on(sql`${t.createdAt} DESC`)
      .where(sql`${t.acknowledgedAt} IS NULL`),
  ],
);

export const operatorReminders = pgTable(
  'operator_reminders',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    enrollmentId: bigint('enrollment_id', { mode: 'number' })
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    incomingMessageId: bigint('incoming_message_id', { mode: 'number' }).references(
      () => incomingMessages.id,
      { onDelete: 'set null' },
    ),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    note: text('note'),
    source: text('source').$type<'manual' | 'not_now' | 'legacy_snooze'>().notNull(),
    status: text('status').$type<'open' | 'done' | 'dismissed'>().notNull().default('open'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    completedAt: tz('completed_at'),
  },
  (t) => [
    index('operator_reminders_open_due')
      .on(t.dueDate, t.id)
      .where(sql`${t.status} = 'open'`),
    uniqueIndex('operator_reminders_not_now_reply')
      .on(t.incomingMessageId)
      .where(sql`${t.source} = 'not_now' AND ${t.incomingMessageId} IS NOT NULL`),
  ],
);
