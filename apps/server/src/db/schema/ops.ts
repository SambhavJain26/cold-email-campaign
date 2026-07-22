// Mirrors 0006_ops.up.sql 1:1 (docs/03 §3).
import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { alertSeverityEnum } from './enums';

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
