// Mirrors 0005_ingest.up.sql 1:1 (docs/03 §3). The SQL file is the source of
// truth for DDL; these definitions exist for typed queries via repos.
import {
  bigint,
  boolean,
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { campaigns, enrollments, events, leads } from './core';
import { sequenceSteps } from './sequences';

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
  copyUpdate: jsonb('copy_update').$type<{ campaign_id: number; counts: Record<string, number> }>(),
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

export const personalizedCopySources = pgTable(
  'personalized_copy_sources',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    slotNo: integer('slot_no').notNull().default(1),
    targetStepNo: integer('target_step_no'),
    sourceImportId: bigint('source_import_id', { mode: 'number' }).references(() => imports.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').$type<'needs_review' | 'ready'>().notNull().default('needs_review'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('personalized_copy_sources_lead_slot').on(t.leadId, t.slotNo),
    index('personalized_copy_sources_import').on(t.sourceImportId, t.slotNo),
  ],
);

export const campaignPersonalizedCopies = pgTable(
  'campaign_personalized_copies',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull().default(1),
    sequenceStepId: bigint('sequence_step_id', { mode: 'number' }).references(
      () => sequenceSteps.id,
      { onDelete: 'restrict' },
    ),
    sourceCopyId: bigint('source_copy_id', { mode: 'number' }).references(
      () => personalizedCopySources.id,
      { onDelete: 'set null' },
    ),
    sourceImportId: bigint('source_import_id', { mode: 'number' }).references(() => imports.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    contentHash: text('content_hash'),
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
  (t) => [
    uniqueIndex('campaign_personalized_copies_lead_campaign_step').on(
      t.leadId,
      t.campaignId,
      t.sequenceStepId,
    ),
    index('campaign_personalized_copies_campaign_status').on(t.campaignId, t.status, t.id),
  ],
);

/** Transitional alias while callers move from Manual Compose naming. */
export const manualCampaignDrafts = campaignPersonalizedCopies;

export const personalizedCopyBlockers = pgTable(
  'personalized_copy_blockers',
  {
    enrollmentId: bigint('enrollment_id', { mode: 'number' })
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    sequenceStepId: bigint('sequence_step_id', { mode: 'number' })
      .notNull()
      .references(() => sequenceSteps.id, { onDelete: 'cascade' }),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    reason: text('reason')
      .$type<'missing' | 'needs_review' | 'invalid_copy' | 'content_conflict'>()
      .notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('personalized_copy_blockers_campaign').on(t.campaignId, t.sequenceStepId, t.reason),
  ],
);
