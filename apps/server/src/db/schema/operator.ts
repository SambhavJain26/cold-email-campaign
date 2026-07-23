// Mirrors 0007_operator.up.sql 1:1 (decision I). Single-row table (id = 1);
// the row is created at first boot by ensureOperator, never in SQL.
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const operator = pgTable('operator', {
  id: integer('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
