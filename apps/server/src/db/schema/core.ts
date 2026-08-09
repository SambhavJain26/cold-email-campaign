// Mirrors 0001_core.up.sql 1:1 (docs/03 §2). The SQL file is the source of
// truth for DDL; these definitions exist for typed queries via repos.
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  campaignStatusEnum,
  enrollmentStateEnum,
  eventTypeEnum,
  leadTierEnum,
  personalizationModeEnum,
  sentimentEnum,
  suppressionReasonEnum,
  unsubscribeSourceEnum,
} from './enums';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const leads = pgTable(
  'leads',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    email: text('email').notNull().unique(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    company: text('company'),
    website: text('website'),
    city: text('city'),
    state: text('state'),
    phone: text('phone'),
    notes: text('notes'),
    customFields: jsonb('custom_fields').notNull().default({}),
    tier: leadTierEnum('tier'),
    isSuppressed: boolean('is_suppressed').notNull().default(false),
    suppressionReason: suppressionReasonEnum('suppression_reason'),
    suppressedAt: tz('suppressed_at'),
    source: text('source'),
    importId: bigint('import_id', { mode: 'number' }),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    isErased: boolean('is_erased').notNull().default(false),
    erasedAt: tz('erased_at'),
  },
  (t) => [
    index('leads_tier')
      .on(t.tier)
      .where(sql`NOT ${t.isSuppressed}`),
  ],
);

export const campaigns = pgTable('campaigns', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull(),
  status: campaignStatusEnum('status').notNull().default('draft'),
  sequenceId: bigint('sequence_id', { mode: 'number' }),
  tierEffortConfig: jsonb('tier_effort_config')
    .notNull()
    .default({ A: 'human_written', B: 'template_researched', C: 'template_auto' }),
  rampConfig: jsonb('ramp_config').notNull().default({ ramp_days: 7, ramp_daily_enroll_cap: 20 }),
  recycledFromCampaignId: bigint('recycled_from_campaign_id', { mode: 'number' }),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id),
    currentState: enrollmentStateEnum('current_state').notNull().default('ACTIVE'),
    currentStepNo: integer('current_step_no').notNull().default(1),
    nextSendAt: tz('next_send_at'),
    assignedMailboxId: bigint('assigned_mailbox_id', { mode: 'number' }),
    enrolledTier: leadTierEnum('enrolled_tier'),
    personalizationMode: personalizationModeEnum('personalization_mode').notNull(),
    softBounceRetries: integer('soft_bounce_retries').notNull().default(0),
    bestReplySentiment: sentimentEnum('best_reply_sentiment'),
    meetingBooked: boolean('meeting_booked').notNull().default(false),
    snoozedUntil: tz('snoozed_until'),
    enrolledAt: tz('enrolled_at').notNull(),
    terminalAt: tz('terminal_at'),
  },
  (t) => [
    unique().on(t.leadId, t.campaignId),
    index('enr_due')
      .on(t.nextSendAt)
      .where(sql`${t.currentState} = 'ACTIVE'`),
    index('enr_state').on(t.campaignId, t.currentState),
    index('enr_mailbox')
      .on(t.assignedMailboxId)
      .where(sql`${t.currentState} = 'ACTIVE'`),
  ],
);

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: eventTypeEnum('type').notNull(),
    occurredAt: tz('occurred_at').notNull(),
    leadId: bigint('lead_id', { mode: 'number' })
      .notNull()
      .references(() => leads.id),
    enrollmentId: bigint('enrollment_id', { mode: 'number' }).references(() => enrollments.id),
    campaignId: bigint('campaign_id', { mode: 'number' }).references(() => campaigns.id),
    stepNo: integer('step_no'),
    mailboxId: bigint('mailbox_id', { mode: 'number' }),
    messageId: text('message_id'),
    sentiment: sentimentEnum('sentiment'),
    source: unsubscribeSourceEnum('source'),
    reason: text('reason'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ev_enrollment').on(t.enrollmentId, t.occurredAt),
    index('ev_lead').on(t.leadId),
    index('ev_campaign').on(t.campaignId, t.type),
    index('ev_mailbox').on(t.mailboxId, t.type, t.occurredAt),
    uniqueIndex('ev_sent_message_id')
      .on(t.messageId)
      .where(sql`${t.type} = 'sent'`),
  ],
);

export const suppressions = pgTable('suppressions', {
  email: text('email').primaryKey(),
  reason: suppressionReasonEnum('reason').notNull(),
  leadId: bigint('lead_id', { mode: 'number' }).references(() => leads.id),
  createdAt: tz('created_at').notNull().defaultNow(),
});
