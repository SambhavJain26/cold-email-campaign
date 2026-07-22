// Mirrors 0005_ingest.up.sql 1:1 (docs/03 §3). The SQL file is the source of
// truth for DDL; these definitions exist for typed queries via repos.
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { leads } from './core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const importRowFlagEnum = pgEnum('import_row_flag', [
  'ok',
  'missing_first_name',
  'role_based',
  'invalid',
  'duplicate',
  'suppressed',
]);

/** Per-flag preview counts (docs/03: imports.counts). */
export type ImportCounts = Record<(typeof importRowFlagEnum.enumValues)[number], number>;

export const imports = pgTable('imports', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  filename: text('filename').notNull(),
  rowsTotal: integer('rows_total').notNull(),
  counts: jsonb('counts').$type<ImportCounts>().notNull(),
  committed: boolean('committed').notNull().default(false),
  commitMode: text('commit_mode'),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const importRows = pgTable(
  'import_rows',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    importId: bigint('import_id', { mode: 'number' })
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    emailNormalized: text('email_normalized'),
    flag: importRowFlagEnum('flag').notNull(),
    leadId: bigint('lead_id', { mode: 'number' }).references(() => leads.id),
  },
  (t) => [index('ir_import_flag').on(t.importId, t.flag)],
);
