// Mirrors 0003_sequences.up.sql 1:1 (docs/03 §3). The SQL file is the
// source of truth for DDL; these definitions exist for typed queries via repos.
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const sequences = pgTable('sequences', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull(),
  stopOnReply: boolean('stop_on_reply').notNull().default(true),
  stopOnHardBounce: boolean('stop_on_hard_bounce').notNull().default(true),
  stopOnUnsubscribe: boolean('stop_on_unsubscribe').notNull().default(true),
  archived: boolean('archived').notNull().default(false),
  variableDefaults: jsonb('variable_defaults')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const sequenceSteps = pgTable(
  'sequence_steps',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    sequenceId: bigint('sequence_id', { mode: 'number' })
      .notNull()
      .references(() => sequences.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull(),
    waitDays: integer('wait_days').notNull().default(0),
    inThread: boolean('in_thread').notNull().default(true),
    contentSource: text('content_source')
      .$type<'template' | 'personalized'>()
      .notNull()
      .default('template'),
  },
  (t) => [unique().on(t.sequenceId, t.stepNo)],
);

/** `{"bespoke":true}` marks a Mode-1 one-off variant (docs/08 §3). */
export interface StepVariantAttributes {
  bespoke?: boolean;
}

export const stepVariants = pgTable(
  'step_variants',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    stepId: bigint('step_id', { mode: 'number' })
      .notNull()
      .references(() => sequenceSteps.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    active: boolean('active').notNull().default(true),
    contentHash: text('content_hash').notNull(),
    attributes: jsonb('attributes').$type<StepVariantAttributes>().notNull().default({}),
  },
  (t) => [unique().on(t.stepId, t.label)],
);
