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
import { campaigns, enrollments, events, leads } from './core';

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

export const campaignLeadPool = pgTable(
  'campaign_lead_pool',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    sourceImportId: bigint('source_import_id', { mode: 'number' }).references(() => imports.id, {
      onDelete: 'set null',
    }),
    allocationOrder: bigint('allocation_order', { mode: 'number' }).notNull(),
    status: text('status')
      .$type<'available' | 'enrolled' | 'released'>()
      .notNull()
      .default('available'),
    enrollmentId: bigint('enrollment_id', { mode: 'number' }).references(() => enrollments.id, {
      onDelete: 'set null',
    }),
    lastEligibilityReason: text('last_eligibility_reason'),
    lastCheckedAt: tz('last_checked_at'),
    allocatedAt: tz('allocated_at').notNull().defaultNow(),
    enrolledAt: tz('enrolled_at'),
    releasedAt: tz('released_at'),
  },
  (t) => [
    index('campaign_lead_pool_campaign_status_order').on(
      t.campaignId,
      t.status,
      t.allocationOrder,
      t.id,
    ),
    index('campaign_lead_pool_source_import').on(t.sourceImportId, t.campaignId),
  ],
);

export const manualCampaignDrafts = pgTable(
  'manual_campaign_drafts',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull().default(1),
    sourceImportId: bigint('source_import_id', { mode: 'number' }).references(() => imports.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status')
      .$type<'needs_review' | 'ready' | 'sent'>()
      .notNull()
      .default('needs_review'),
    sentEventId: bigint('sent_event_id', { mode: 'number' }).references(() => events.id),
    sentMessageId: text('sent_message_id'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    sentAt: tz('sent_at'),
  },
  (t) => [index('manual_campaign_drafts_campaign_status').on(t.campaignId, t.status, t.id)],
);
