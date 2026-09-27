// Mirrors 0002_seed.up.sql (docs/03 §3). Single-row tables (id = 1).
import { boolean, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  stopOnReply: boolean('stop_on_reply').notNull().default(true),
  stopOnHardBounce: boolean('stop_on_hard_bounce').notNull().default(true),
  softRetryMax: integer('soft_retry_max').notNull().default(2),
  suppressUnsubs: boolean('suppress_unsubs').notNull().default(true),
  enforceSendWindow: boolean('enforce_send_window').notNull().default(true),
  optoutDetection: text('optout_detection').notNull().default('auto'),
  pauseMinSends: integer('pause_min_sends').notNull().default(25),
  pauseHardPct: numeric('pause_hard_pct').notNull().default('4.0'),
  pauseWindowSends: integer('pause_window_sends').notNull().default(50),
  pauseAbsoluteBounces: integer('pause_absolute_bounces').notNull().default(3),
  pauseAbsoluteSpan: integer('pause_absolute_span').notNull().default(10),
  resumeCapPct: integer('resume_cap_pct').notNull().default(50),
  schedulerTickMinutes: integer('scheduler_tick_minutes').notNull().default(5),
  pollIntervalMinutes: integer('poll_interval_minutes').notNull().default(5),
  stalePollHours: integer('stale_poll_hours').notNull().default(6),
  deliveryConfirmHours: integer('delivery_confirm_hours').notNull().default(6),
  sendJitterPct: integer('send_jitter_pct').notNull().default(20),
  defaultTimezone: text('default_timezone').notNull().default('America/New_York'),
  coldStorageRestDays: integer('cold_storage_rest_days').notNull().default(60),
  // Launch guardrails (0011): ceilings on what may be CONFIGURED, so a typo
  // cannot create an unsafe first-day volume. minRampDays 0 = not enforced.
  maxMailboxDailyCap: integer('max_mailbox_daily_cap').notNull().default(50),
  maxRampDailyEnrollCap: integer('max_ramp_daily_enroll_cap').notNull().default(25),
  minRampDays: integer('min_ramp_days').notNull().default(0),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export const complianceSettings = pgTable('compliance_settings', {
  id: integer('id').primaryKey(),
  physicalAddress: text('physical_address').notNull().default(''),
  optoutText: text('optout_text').notNull(),
  signatureName: text('signature_name').notNull().default('Sambhav Jain'),
  signatureRoleLine: text('signature_role_line')
    .notNull()
    .default('Automation Specialist | Sambhav Builds'),
  fromNameRules: text('from_name_rules'),
  /** Base URL of the public unsubscribe endpoint; '' = feature dormant (0010). */
  unsubscribeBaseUrl: text('unsubscribe_base_url').notNull().default(''),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
