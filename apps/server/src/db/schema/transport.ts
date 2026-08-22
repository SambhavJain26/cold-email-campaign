// Mirrors 0004_transport_tables.up.sql 1:1 (docs/03 §3). The SQL file is the
// source of truth for DDL; these definitions exist for typed queries via repos.
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { enrollments } from './core';
import { incomingClassEnum, mailboxStatusEnum, sentimentEnum } from './enums';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// drizzle-orm 0.45 has no built-in bytea column type.
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export interface SendWindow {
  days: number[]; // ISO weekday numbers, 1=Mon … 7=Sun
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}

export const mailboxes = pgTable('mailboxes', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  displayName: text('display_name').notNull(),
  fromAddress: text('from_address').notNull().unique(),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull().default(587),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull().default(993),
  authType: text('auth_type').notNull().default('app_password'),
  dailyCap: integer('daily_cap').notNull().default(30),
  sendWindow: jsonb('send_window')
    .$type<SendWindow>()
    .notNull()
    .default({ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }),
  timezone: text('timezone').notNull().default('America/New_York'),
  status: mailboxStatusEnum('status').notNull().default('ok'),
  statusReason: text('status_reason'),
  resumeCap: integer('resume_cap'),
  pausedAt: tz('paused_at'),
  lastSendAt: tz('last_send_at'),
  lastSuccessfulPollAt: tz('last_successful_poll_at'),
  /** Superseded by mailboxPollCursors (0012); retained so 0012 is reversible. */
  lastPollUid: bigint('last_poll_uid', { mode: 'number' }).notNull().default(0),
  /** Folders this mailbox polls. INBOX-only by default (finding 13). */
  pollFolders: text('poll_folders').array().notNull().default(['INBOX']),
  createdAt: tz('created_at').notNull().defaultNow(),
});

/**
 * Per-(mailbox, folder) UID high-water mark (0012). IMAP UIDs are scoped to a
 * folder, so INBOX and Spam cursors are unrelated numbers and cannot share one
 * column.
 */
export const mailboxPollCursors = pgTable(
  'mailbox_poll_cursors',
  {
    mailboxId: bigint('mailbox_id', { mode: 'number' })
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    folder: text('folder').notNull(),
    lastPollUid: bigint('last_poll_uid', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.mailboxId, t.folder] })],
);

export const mailboxSecrets = pgTable('mailbox_secrets', {
  mailboxId: bigint('mailbox_id', { mode: 'number' })
    .primaryKey()
    .references(() => mailboxes.id, { onDelete: 'cascade' }),
  sealed: bytea('sealed').notNull(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export const mailboxOauthCredentials = pgTable('mailbox_oauth_credentials', {
  mailboxId: bigint('mailbox_id', { mode: 'number' })
    .primaryKey()
    .references(() => mailboxes.id, { onDelete: 'cascade' }),
  sealedRefreshToken: bytea('sealed_refresh_token').notNull(),
  grantedEmail: text('granted_email').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export const mailboxOauthStates = pgTable(
  'mailbox_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    mailboxId: bigint('mailbox_id', { mode: 'number' })
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    sealedCodeVerifier: bytea('sealed_code_verifier').notNull(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
  },
  (t) => [index('mailbox_oauth_states_expiry').on(t.expiresAt)],
);

export const sentMessages = pgTable(
  'sent_messages',
  {
    messageId: text('message_id').primaryKey(),
    enrollmentId: bigint('enrollment_id', { mode: 'number' })
      .notNull()
      .references(() => enrollments.id),
    leadId: bigint('lead_id', { mode: 'number' }).notNull(),
    mailboxId: bigint('mailbox_id', { mode: 'number' }).notNull(),
    stepNo: integer('step_no').notNull(),
    contentHash: text('content_hash').notNull(),
    sentAt: tz('sent_at').notNull(),
  },
  (t) => [index('sm_lead').on(t.leadId)],
);

export const incomingMessages = pgTable(
  'incoming_messages',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    mailboxId: bigint('mailbox_id', { mode: 'number' })
      .notNull()
      .references(() => mailboxes.id),
    imapUid: bigint('imap_uid', { mode: 'number' }).notNull(),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    fromAddress: text('from_address'),
    subject: text('subject'),
    receivedAt: tz('received_at'),
    processedAt: tz('processed_at').notNull(),
    classification: incomingClassEnum('classification').notNull(),
    matchedEnrollmentId: bigint('matched_enrollment_id', { mode: 'number' }).references(
      () => enrollments.id,
    ),
    resultingEventIds: bigint('resulting_event_ids', { mode: 'number' }).array().notNull(),
    suggestedSentiment: sentimentEnum('suggested_sentiment'),
    dsnStatus: text('dsn_status'),
    snippet: text('snippet'),
    bodyText: text('body_text'), // full unquoted reply text (0007) — unibox detail view
  },
  (t) => [
    unique().on(t.mailboxId, t.imapUid),
    index('im_class').on(t.classification, sql`${t.processedAt} DESC`),
    uniqueIndex('im_msgid')
      .on(t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
  ],
);
