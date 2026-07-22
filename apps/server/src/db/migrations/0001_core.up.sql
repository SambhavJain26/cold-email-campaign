-- 0001_core: enums, leads, campaigns, enrollments, events (append-only:
-- trigger + role grants), suppressions. Mirrors docs/03-database-schema.md.
-- Columns referencing tables from later migrations (mailboxes -> 0004,
-- sequences -> 0003, imports -> 0005) are plain bigint here; those
-- migrations add the FKs.

CREATE TYPE event_type AS ENUM (
  'enrolled','sent','delivered','soft_bounce','hard_bounce',
  'human_reply','auto_reply','unsubscribe','meeting_booked',
  'deal_won','deal_lost',
  'sentiment_tagged'            -- decision M: tagging is an event, not an UPDATE
);
CREATE TYPE enrollment_state   AS ENUM ('NEW','ACTIVE','REPLIED','BOUNCED','UNSUBSCRIBED','COMPLETED');
CREATE TYPE sentiment          AS ENUM ('positive','neutral','negative');
CREATE TYPE lead_tier          AS ENUM ('A','B','C','nurture');
CREATE TYPE suppression_reason AS ENUM ('unsubscribed','hard_bounce','manual');
CREATE TYPE personalization_mode AS ENUM ('human_written','template_researched','template_auto');
CREATE TYPE unsubscribe_source AS ENUM ('reply','link','manual');
CREATE TYPE campaign_status    AS ENUM ('draft','active','paused','completed','archived');

-- App role (prod connects as app_rw; dev/test connect as owner but the trigger
-- still enforces append-only). Cluster-wide object: created idempotently,
-- never dropped by the down migration.
DO $do$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END $do$;
GRANT USAGE ON SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

CREATE TABLE leads (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,             -- normalized (decision L)
  first_name    text,
  last_name     text,
  company       text,
  website       text,
  city          text,
  state         text,                             -- US 2-letter; tz resolution (decision X)
  phone         text,
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier          lead_tier,                        -- NULL = untiered (decision R)
  is_suppressed bool NOT NULL DEFAULT false,
  suppression_reason suppression_reason,
  suppressed_at timestamptz,
  source        text,
  import_id     bigint,                           -- FK added in 0005
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_tier ON leads (tier) WHERE NOT is_suppressed;

CREATE TABLE campaigns (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text NOT NULL,
  status             campaign_status NOT NULL DEFAULT 'draft',
  sequence_id        bigint,                      -- FK added in 0003
  tier_effort_config jsonb NOT NULL DEFAULT '{"A":"human_written","B":"template_researched","C":"template_auto"}'::jsonb,
  ramp_config        jsonb NOT NULL DEFAULT '{"ramp_days":7,"ramp_daily_enroll_cap":20}'::jsonb,
  recycled_from_campaign_id bigint REFERENCES campaigns(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id              bigint NOT NULL REFERENCES leads(id),
  campaign_id          bigint NOT NULL REFERENCES campaigns(id),
  current_state        enrollment_state NOT NULL DEFAULT 'ACTIVE',  -- PROJECTION (reducer output only)
  current_step_no      int NOT NULL DEFAULT 1,
  next_send_at         timestamptz,
  assigned_mailbox_id  bigint,                    -- FK added in 0004; fixed at first send
  enrolled_tier        lead_tier,
  personalization_mode personalization_mode NOT NULL,
  soft_bounce_retries  int NOT NULL DEFAULT 0,
  best_reply_sentiment sentiment,
  meeting_booked       bool NOT NULL DEFAULT false,
  snoozed_until        timestamptz,
  enrolled_at          timestamptz NOT NULL,
  terminal_at          timestamptz,
  UNIQUE (lead_id, campaign_id)
);
CREATE INDEX enr_due     ON enrollments (next_send_at) WHERE current_state = 'ACTIVE';
CREATE INDEX enr_state   ON enrollments (campaign_id, current_state);
CREATE INDEX enr_mailbox ON enrollments (assigned_mailbox_id) WHERE current_state = 'ACTIVE';

CREATE TABLE events (
  id            bigserial PRIMARY KEY,            -- monotonic append order
  type          event_type   NOT NULL,
  occurred_at   timestamptz  NOT NULL,            -- from Clock, NOT default now()
  lead_id       bigint       NOT NULL REFERENCES leads(id),
  enrollment_id bigint       REFERENCES enrollments(id),
  campaign_id   bigint       REFERENCES campaigns(id),
  step_no       int,
  mailbox_id    bigint,                           -- FK added in 0004
  message_id    text,                             -- sent: the threading anchor
  sentiment     sentiment,
  source        unsubscribe_source,
  reason        text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ev_enrollment ON events (enrollment_id, occurred_at);
CREATE INDEX ev_lead       ON events (lead_id);
CREATE INDEX ev_campaign   ON events (campaign_id, type);
CREATE INDEX ev_mailbox    ON events (mailbox_id, type, occurred_at);
CREATE UNIQUE INDEX ev_sent_message_id ON events (message_id) WHERE type = 'sent';

CREATE TABLE suppressions (
  email      text PRIMARY KEY,                    -- normalized; survives lead deletion
  reason     suppression_reason NOT NULL,
  lead_id    bigint REFERENCES leads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only is physics, not policy (docs/03 s4):
-- 1. trigger blocks UPDATE/DELETE for every role including the owner
CREATE FUNCTION events_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'events is append-only';
END $fn$;
CREATE TRIGGER events_no_mutation
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_immutable();
-- 2. the app role additionally lacks the grants entirely
REVOKE UPDATE, DELETE ON events FROM app_rw;
