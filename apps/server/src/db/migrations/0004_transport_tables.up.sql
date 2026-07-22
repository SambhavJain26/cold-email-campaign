-- 0004_transport_tables: mailboxes, mailbox_secrets, sent_messages,
-- incoming_messages (docs/03 §3) + the FKs deferred from 0001
-- (events.mailbox_id, enrollments.assigned_mailbox_id).
-- Applied before 0003_sequences lands (B4): the runner applies pending
-- migrations in filename order and nothing here depends on sequences.

CREATE TYPE mailbox_status AS ENUM
  ('ok','paused','auto_paused','auth_failed','imap_stale','provider_blocked');
CREATE TYPE incoming_class AS ENUM ('bounce','auto_reply','human_reply','unrelated');

CREATE TABLE mailboxes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name   text NOT NULL,
  from_address   text NOT NULL UNIQUE,
  smtp_host      text NOT NULL,
  smtp_port      int  NOT NULL DEFAULT 587,
  imap_host      text NOT NULL,
  imap_port      int  NOT NULL DEFAULT 993,
  auth_type      text NOT NULL DEFAULT 'app_password',
  daily_cap      int  NOT NULL DEFAULT 30,
  send_window    jsonb NOT NULL DEFAULT '{"days":[1,2,3,4,5],"start":"08:00","end":"17:00"}',
                 -- evaluated in RECIPIENT tz (docs/06 §4)
  status         mailbox_status NOT NULL DEFAULT 'ok',
  status_reason  text,
  resume_cap     int,                              -- 50%-cap resume after auto-pause
  paused_at      timestamptz,
  last_send_at   timestamptz,                      -- pacing anchor (decision P)
  last_successful_poll_at timestamptz,
  last_poll_uid  bigint NOT NULL DEFAULT 0,        -- IMAP UID high-water mark
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailbox_secrets (
  mailbox_id bigint PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
  sealed     bytea NOT NULL,                       -- libsodium secretbox(app password)
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reply-matching projection (rebuildable from sent events)
CREATE TABLE sent_messages (
  message_id    text PRIMARY KEY,
  enrollment_id bigint NOT NULL REFERENCES enrollments(id),
  lead_id       bigint NOT NULL,
  mailbox_id    bigint NOT NULL,
  step_no       int NOT NULL,
  content_hash  text NOT NULL,
  sent_at       timestamptz NOT NULL
);
CREATE INDEX sm_lead ON sent_messages (lead_id);

-- Poller ledger + debug view source (decision O). A ledger, NOT a projection
-- — never rebuilt from events.
CREATE TABLE incoming_messages (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mailbox_id             bigint NOT NULL REFERENCES mailboxes(id),
  imap_uid               bigint NOT NULL,
  message_id             text,                     -- inbound Message-ID header
  in_reply_to            text,
  from_address           text,
  subject                text,
  received_at            timestamptz,
  processed_at           timestamptz NOT NULL,
  classification         incoming_class NOT NULL,
  matched_enrollment_id  bigint REFERENCES enrollments(id),
  resulting_event_ids    bigint[] NOT NULL DEFAULT '{}',
  suggested_sentiment    sentiment,                -- AI suggestion (decision E); null if off
  dsn_status             text,                     -- '5.1.1' etc when classification=bounce
  snippet                text,                     -- first 300 chars unquoted text
  UNIQUE (mailbox_id, imap_uid)
);
CREATE INDEX im_class ON incoming_messages (classification, processed_at DESC);
CREATE UNIQUE INDEX im_msgid ON incoming_messages (message_id) WHERE message_id IS NOT NULL;

-- FKs deferred from 0001 (columns existed as plain bigint until now)
ALTER TABLE events
  ADD CONSTRAINT events_mailbox_id_fkey
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id);
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_assigned_mailbox_id_fkey
  FOREIGN KEY (assigned_mailbox_id) REFERENCES mailboxes(id);
