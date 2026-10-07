# Database Schema — Full DDL

> **Migrations 0022–0024:** event/enrollment enums add `outreach_stopped` / `STOPPED`;
> `settings.incoming_stop_since` is a persistent non-null deployment cutoff defaulting to now();
> compliance signature role/address defaults and operator configuration adopt the requested
> four-line structure; `imports.copy_update` stores campaign ID and status counts. Stop vocabulary,
> cutoff and committed import history survive rollback. Sent snapshots and events remain immutable.

> **Migration 0019 overlay:** current copy/tier tables and compatibility rules are specified in
> [docs/22](22-personalized-copy-two-tier.md). In particular, `personalized_copy_sources`,
> `campaign_personalized_copies`, `personalized_copy_blockers`, step `content_source`, separate
> `outreach_status`, and sent-content snapshots supersede conflicting pre-0019 excerpts below.

The complete Postgres schema. Drizzle definitions in `apps/server/src/db/schema/` must mirror this file 1:1; this file is the human-readable source. Migration policy: §6. Spec traceability: events/enums map to spec Parts 2–3; settings values to Part 11.

All timestamps are `timestamptz` (UTC). All emails stored normalized (decision L).

---

## 1. Enums

```sql
CREATE TYPE event_type AS ENUM (
  'enrolled','sent','delivered','soft_bounce','hard_bounce',
  'human_reply','auto_reply','unsubscribe','meeting_booked',
  'deal_won','deal_lost',
  'sentiment_tagged'            -- decision M (12th type, projection-only)
);
CREATE TYPE enrollment_state   AS ENUM ('NEW','ACTIVE','REPLIED','BOUNCED','UNSUBSCRIBED','COMPLETED');
CREATE TYPE sentiment          AS ENUM ('positive','neutral','negative');
CREATE TYPE lead_tier          AS ENUM ('A','B','C','nurture');          -- leads.tier is NULLable (decision R)
CREATE TYPE mailbox_status     AS ENUM ('ok','paused','auto_paused','auth_failed','imap_stale','provider_blocked');
CREATE TYPE suppression_reason AS ENUM ('unsubscribed','hard_bounce','manual');
CREATE TYPE personalization_mode AS ENUM ('human_written','template_researched','template_auto');
CREATE TYPE unsubscribe_source AS ENUM ('reply','link','manual');
CREATE TYPE incoming_class     AS ENUM ('bounce','auto_reply','human_reply','unrelated');
CREATE TYPE campaign_status    AS ENUM ('draft','active','paused','completed','archived');
CREATE TYPE import_row_flag    AS ENUM ('ok','role_based','invalid','duplicate','suppressed','missing_first_name');
CREATE TYPE alert_severity     AS ENUM ('info','warning','error');
```

## 2. Core tables

### `events` — append-only source of truth (spec Part 2)

```sql
CREATE TABLE events (
  id            bigserial PRIMARY KEY,
  type          event_type   NOT NULL,
  occurred_at   timestamptz  NOT NULL,           -- from Clock, NOT default now()
  lead_id       bigint       NOT NULL REFERENCES leads(id),
  enrollment_id bigint       REFERENCES enrollments(id),   -- null only for lead-level events pre-enrollment
  campaign_id   bigint       REFERENCES campaigns(id),     -- denormalized for metric GROUP BYs
  step_no       int,                              -- sent/delivered/bounces/human_reply
  mailbox_id    bigint       REFERENCES mailboxes(id),     -- enrolled/sent/bounces
  message_id    text,                             -- sent: the threading anchor (Part 6)
  sentiment     sentiment,                        -- human_reply (only if known at insert: STOP auto-detect) ; sentiment_tagged (always)
  source        unsubscribe_source,               -- unsubscribe
  reason        text,                             -- bounces: DSN code+text ; auto_reply: matched pattern
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ev_enrollment ON events (enrollment_id, occurred_at);
CREATE INDEX ev_lead       ON events (lead_id);
CREATE INDEX ev_campaign   ON events (campaign_id, type);
CREATE INDEX ev_mailbox    ON events (mailbox_id, type, occurred_at);  -- rolling-window bounce queries
CREATE UNIQUE INDEX ev_sent_message_id ON events (message_id) WHERE type = 'sent';
```

Per-type required `attributes` keys (validated in `domain/events.ts`, not by the DB):

| type | attributes |
|------|-----------|
| `sent` | `content_hash` (decision Q), `variant_id?`, `subject_rendered_hash?` |
| `soft_bounce` | `retry_no` (1-based) |
| `human_reply` | `incoming_message_id` (FK-ish to incoming_messages.id) |
| `sentiment_tagged` | `reply_event_id`, `tagged_by: 'human'` |
| `unsubscribe` | `matched_keyword?` (when source=reply) |
| `meeting_booked` | — |

### `leads`

```sql
CREATE TABLE leads (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,             -- normalized
  first_name    text,                             -- null → {{first_name|there}}
  last_name     text,
  company       text,
  website       text,
  city          text,
  state         text,                             -- US 2-letter; drives tz resolution (decision X)
  phone         text,
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier          lead_tier,                        -- NULL = untiered (decision R)
  is_suppressed bool NOT NULL DEFAULT false,
  suppression_reason suppression_reason,
  suppressed_at timestamptz,
  source        text,
  import_id     bigint REFERENCES imports(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_tier ON leads (tier) WHERE NOT is_suppressed;
```

### `suppressions` — global, permanent, keyed by email

```sql
CREATE TABLE suppressions (
  email      text PRIMARY KEY,                    -- normalized; survives lead deletion, blocks re-import
  reason     suppression_reason NOT NULL,
  lead_id    bigint REFERENCES leads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Kept in lockstep with `leads.is_suppressed` inside the same transaction that appends the `unsubscribe`/`hard_bounce` event.

### `campaigns`

```sql
CREATE TABLE campaigns (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text NOT NULL,
  status             campaign_status NOT NULL DEFAULT 'draft',
  sequence_id        bigint REFERENCES sequences(id),
  tier_effort_config jsonb NOT NULL DEFAULT '{"A":"human_written","B":"template_researched","C":"template_auto"}',
  ramp_config        jsonb NOT NULL DEFAULT '{"ramp_days":7,"ramp_daily_enroll_cap":20}',
  variable_overrides jsonb NOT NULL DEFAULT '{}',
  resolved_variables jsonb NOT NULL DEFAULT '{}',
  auto_observation_field text,
  auto_observation_rules jsonb NOT NULL DEFAULT '{}',
  first_activated_at timestamptz,
  ramp_stages        jsonb NOT NULL,
  lead_selection_mode text NOT NULL DEFAULT 'global', -- global | pool; pool cannot revert
  auto_enroll_enabled boolean NOT NULL DEFAULT false,
  steady_daily_enroll_cap int NOT NULL DEFAULT 15,
  recycled_from_campaign_id bigint REFERENCES campaigns(id),   -- deprecated single-source compatibility
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

Migration `0017` makes recycle provenance many-to-many while retaining the legacy campaign column
for rollback/API compatibility. `campaign_recycle_sources` preserves every selected source;
`recycle_enrollment_sources` records every qualifying source enrollment for each newly created
target enrollment. A lead present in two sources therefore has one target enrollment and two
provenance links. Existing single-source campaigns and matching enrollments are backfilled.

```sql
CREATE TABLE campaign_recycle_sources (
  target_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_campaign_id, source_campaign_id),
  CHECK (target_campaign_id <> source_campaign_id)
);

CREATE TABLE recycle_enrollment_sources (
  target_enrollment_id bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_enrollment_id bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_enrollment_id, source_enrollment_id)
);
```

Migration `0018` adds campaign-scoped lead pools, opt-in automatic enrollment, and the permanent
post-ramp daily cap. Existing campaigns remain in `global` selection mode with auto-enrollment off.
Their permanent cap is copied from their final ramp stage (15 only as a malformed-data fallback).
A trigger prevents a pool-backed campaign returning to the global selector and prevents increasing
the permanent cap after first activation.

```sql
CREATE TABLE campaign_lead_pool (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_import_id bigint REFERENCES imports(id) ON DELETE SET NULL,
  allocation_order bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('available','enrolled','released')),
  enrollment_id bigint REFERENCES enrollments(id) ON DELETE SET NULL,
  last_eligibility_reason text,
  last_checked_at timestamptz,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  enrolled_at timestamptz,
  released_at timestamptz,
  UNIQUE (campaign_id, lead_id)
);

CREATE UNIQUE INDEX campaign_lead_pool_one_available_campaign
  ON campaign_lead_pool (lead_id) WHERE status = 'available';
```

`auto_enrollment_days` is the one-claim-per-application-local-date idempotency ledger.
`auto_enrollment_runs` records trigger, date, capacity snapshot, cursor, status, and failure;
`auto_enrollment_run_campaigns` records per-campaign eligible/cap/enrolled/skipped results.
`auto_enrollment_state` stores the last-served campaign for fair round-robin continuation. Pool
consumption, enrollment insertion, projections, and the append-only `enrolled` event share one
transaction.

### `enrollments` — the state machine lives here (spec Part 3)

```sql
CREATE TABLE enrollments (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id              bigint NOT NULL REFERENCES leads(id),
  campaign_id          bigint NOT NULL REFERENCES campaigns(id),
  current_state        enrollment_state NOT NULL DEFAULT 'ACTIVE',   -- PROJECTION (reducer output only)
  current_step_no      int NOT NULL DEFAULT 1,
  next_send_at         timestamptz,                     -- null once terminal
  assigned_mailbox_id  bigint REFERENCES mailboxes(id), -- fixed at FIRST send; never rerouted (Part 9)
  enrolled_tier        lead_tier,                       -- snapshot at enrollment (may be null = untiered)
  personalization_mode personalization_mode NOT NULL,
  soft_bounce_retries  int NOT NULL DEFAULT 0,          -- projection of soft_bounce events, max 2
  best_reply_sentiment sentiment,                       -- projection (decision M resolution order)
  meeting_booked       bool NOT NULL DEFAULT false,     -- milestone flag, NOT a state
  snoozed_until        timestamptz,                     -- legacy ACTIVE-enrollment scheduling only
  enrolled_at          timestamptz NOT NULL,
  terminal_at          timestamptz,
  UNIQUE (lead_id, campaign_id)
);
CREATE INDEX enr_due    ON enrollments (next_send_at) WHERE current_state = 'ACTIVE';
CREATE INDEX enr_state  ON enrollments (campaign_id, current_state);
CREATE INDEX enr_mailbox ON enrollments (assigned_mailbox_id) WHERE current_state = 'ACTIVE';
```

### `operator_reminders`

In-app operator tasks are independent from enrollment scheduling and permission to contact.

```sql
CREATE TABLE operator_reminders (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id       bigint NOT NULL REFERENCES enrollments(id),
  incoming_message_id bigint REFERENCES incoming_messages(id),
  due_date             date NOT NULL,
  note                 text,
  source               text NOT NULL CHECK (source IN ('manual','not_now','legacy_snooze')),
  status               text NOT NULL CHECK (status IN ('open','done','dismissed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);
```

Migration `0015` converts future snoozes on replied enrollments into `legacy_snooze` reminders.
It deliberately preserves existing snoozes on active enrollments, where they retain their old
scheduler meaning.

### `manual_campaign_drafts`

Migration `0016` stores campaign-scoped Step-1 drafts separately from lead profile data. Only one
unsent draft may exist per `(lead_id, campaign_id, step_no)`. Status is `needs_review`, `ready`, or
`sent`; successful sending links the draft to its append-only event and message ID. The same
migration adds sequence defaults, campaign overrides/frozen snapshots, Auto Observation rules,
first activation, and staged ramp configuration. A database trigger freezes those campaign fields
after first activation.

## 3. Supporting tables

### `sequences`, `sequence_steps`, `step_variants`

```sql
CREATE TABLE sequences (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  text NOT NULL,
  stop_on_reply         bool NOT NULL DEFAULT true, -- constrained true since 0013
  stop_on_hard_bounce   bool NOT NULL DEFAULT true,
  stop_on_unsubscribe   bool NOT NULL DEFAULT true,
  variable_defaults     jsonb NOT NULL DEFAULT '{}',
  archived              bool NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sequence_steps (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sequence_id bigint NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_no     int NOT NULL,
  wait_days   int NOT NULL DEFAULT 0,          -- days after previous step's send
  in_thread   bool NOT NULL DEFAULT true,      -- carries In-Reply-To/References
  UNIQUE (sequence_id, step_no)
);
CREATE TABLE step_variants (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step_id          bigint NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  label            text NOT NULL,              -- 'A','B',...
  subject_template text NOT NULL,
  body_template    text NOT NULL,              -- footer NOT stored here (appended at render)
  active           bool NOT NULL DEFAULT true,
  content_hash     text NOT NULL,              -- sha256(subject||'\0'||body), recomputed on save (decision Q)
  attributes       jsonb NOT NULL DEFAULT '{}', -- {"bespoke":true} = Mode-1 one-off variant (docs/08 §3)
  UNIQUE (step_id, label)
);
```

### `sent_messages` — reply-matching projection (rebuildable)

```sql
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
```

### `incoming_messages` — poller ledger + debug view source (decision O)

```sql
CREATE TABLE incoming_messages (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mailbox_id             bigint NOT NULL REFERENCES mailboxes(id),
  imap_uid               bigint NOT NULL,
  message_id             text,                       -- inbound Message-ID header
  in_reply_to            text,
  from_address           text,
  subject                text,
  received_at            timestamptz,
  processed_at           timestamptz NOT NULL,
  classification         incoming_class NOT NULL,
  matched_enrollment_id  bigint REFERENCES enrollments(id),
  resulting_event_ids    bigint[] NOT NULL DEFAULT '{}',
  suggested_sentiment    sentiment,                  -- AI suggestion (decision E); null if off
  dsn_status             text,                       -- '5.1.1' etc when classification=bounce
  snippet                text,                       -- first 300 chars unquoted text, for Unibox list
  body_text              text,                       -- full unquoted reply text (0007) — Unibox detail view
  UNIQUE (mailbox_id, imap_uid)
);
CREATE INDEX im_class ON incoming_messages (classification, processed_at DESC);
CREATE UNIQUE INDEX im_msgid ON incoming_messages (message_id) WHERE message_id IS NOT NULL;
```

### `mailboxes` + `mailbox_secrets`

```sql
CREATE TABLE mailboxes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name   text NOT NULL,
  from_address   text NOT NULL UNIQUE,
  smtp_host      text NOT NULL,  smtp_port int NOT NULL DEFAULT 587,
  imap_host      text NOT NULL,  imap_port int NOT NULL DEFAULT 993,
  auth_type      text NOT NULL DEFAULT 'app_password',
  daily_cap      int  NOT NULL DEFAULT 30,
  send_interval_minutes int CHECK (send_interval_minutes BETWEEN 1 AND 1440), -- 0025; NULL preserves legacy pacing
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
```

`sent_today` is **not** a column — it's `COUNT(sent events since mailbox-local midnight)` (plan §4.2), cached per-tick in memory only.

### `imports`, `import_rows`

```sql
CREATE TABLE imports (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename       text NOT NULL,
  rows_total     int NOT NULL,
  counts         jsonb NOT NULL,      -- {"ok":885,"role_based":60,"invalid":40,"duplicate":15,"suppressed":0,"missing_first_name":82}
  committed      bool NOT NULL DEFAULT false,
  commit_mode    text,                -- 'drop_flagged' | 'import_all'
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_rows (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id bigint NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_no    int NOT NULL,
  raw       jsonb NOT NULL,
  email_normalized text,
  flag      import_row_flag NOT NULL,
  lead_id   bigint REFERENCES leads(id)   -- set on commit for imported rows
);
```

### `settings` (single row, id=1), `compliance_settings` (single row), `operator`, `alerts`

```sql
CREATE TABLE settings (
  id int PRIMARY KEY CHECK (id = 1),
  stop_on_reply bool NOT NULL DEFAULT true,
  stop_on_hard_bounce bool NOT NULL DEFAULT true,
  soft_retry_max int NOT NULL DEFAULT 2,
  suppress_unsubs bool NOT NULL DEFAULT true,
  enforce_send_window bool NOT NULL DEFAULT true,
  optout_detection text NOT NULL DEFAULT 'auto' CHECK (optout_detection IN ('auto','tag_only')),
  -- bounce auto-pause (spec Part 11)
  pause_min_sends int NOT NULL DEFAULT 25,
  pause_hard_pct numeric NOT NULL DEFAULT 4.0,
  pause_window_sends int NOT NULL DEFAULT 50,
  pause_absolute_bounces int NOT NULL DEFAULT 3,
  pause_absolute_span int NOT NULL DEFAULT 10,
  resume_cap_pct int NOT NULL DEFAULT 50,
  -- timing
  scheduler_tick_minutes int NOT NULL DEFAULT 5,
  poll_interval_minutes int NOT NULL DEFAULT 5,
  stale_poll_hours int NOT NULL DEFAULT 6,
  delivery_confirm_hours int NOT NULL DEFAULT 6, -- immutable after first sent event (0013)
  send_jitter_pct int NOT NULL DEFAULT 20,
  default_timezone text NOT NULL DEFAULT 'America/New_York',
  cold_storage_rest_days int NOT NULL DEFAULT 60,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE compliance_settings (
  id int PRIMARY KEY CHECK (id = 1),
  physical_address text NOT NULL DEFAULT '',
  optout_text text NOT NULL DEFAULT E'Don''t want future emails? Reply STOP and I''ll remove you immediately.',
  from_name_rules text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operator (
  id int PRIMARY KEY CHECK (id = 1),
  email text NOT NULL,
  password_hash text NOT NULL,          -- argon2id
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now() -- bumped on password change
);
CREATE TABLE alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  severity alert_severity NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_unacked ON alerts (created_at DESC) WHERE acknowledged_at IS NULL;
```

Seeds (migration `0002_seed`): `settings` row, `compliance_settings` row. The `operator` row is NOT seeded in SQL — it needs an argon2id hash of `OPERATOR_INITIAL_PASSWORD`, so `ensureOperator` creates it at first boot (B6.1); the table itself lands in `0007_operator`.

**Cold Storage is a query, not a lead-copy table** (plan §4.2): source enrollments `COMPLETED`
joined to leads, with `terminal_at + rest_days` computing earliest recycle. The two provenance
tables above record a recycle action and its source relationships; they never replace or rewrite
the source enrollment.

## 4. Append-only enforcement (plan Stage 1)

```sql
CREATE FUNCTION events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'events is append-only'; END $$;
CREATE TRIGGER events_no_mutation
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_immutable();

-- role hardening (migration creates app_rw; the app never connects as owner in prod)
REVOKE UPDATE, DELETE ON events FROM app_rw;
GRANT  INSERT, SELECT ON events TO app_rw;
```

## 5. Projection rebuild targets

`rebuild-projections` (docs/04 §5) reconstructs from `events` alone: `enrollments.{current_state, current_step_no, soft_bounce_retries, best_reply_sentiment, meeting_booked, terminal_at, next_send_at*}`, `sent_messages` (from `sent` events), `leads.is_suppressed` + `suppressions` (from `unsubscribe`/`hard_bounce`). (*`next_send_at` is recomputed from the sequence definition + last `sent`.) `incoming_messages` is a ledger, not a projection — it is **not** rebuilt.

## Pre-canary additions (migration `0008_precanary`)

- `mailboxes.timezone` is a required IANA timezone, backfilled to `America/New_York`. It defines that mailbox's daily-cap reset and is the fallback for leads without a resolvable recipient timezone.
- `leads.is_erased` and `leads.erased_at` mark an irreversible privacy erasure. The row becomes a non-routable tombstone; events retain non-identifying lineage. Normal lead, enrollment, scheduler, capacity, outcome, and metric queries exclude erased leads.

## 6. Migration policy

- Migrations are **hand-authored paired SQL files** (`NNNN_name.up.sql` / `NNNN_name.down.sql`) in `apps/server/src/db/migrations/`, executed by the in-repo runner (`src/db/migrate.ts`, tracked in `schema_migrations`), committed to git, applied on boot (prod) and by `npm run db:migrate` / `db:rollback` / `db:status`. drizzle-kit is generation-assist only (diff SQL from schema defs into gitignored `drizzle-kit-out/`, hand-copied in) — it cannot execute or roll back migrations. *(Changed at B0.4: drizzle-kit has no down-migration support, and this doc requires tested downs; hand-written DDL also fits the trigger/grant-heavy schema.)*
- Numbered migrations continue through `0010_unsubscribe`, `0011_guardrails`,
  `0012_poll_folders`, `0013_reply_safety`, `0014_google_oauth`, `0015_operational_workflows`,
  `0016_personalization_ramp`, `0017_multi_source_recycling`, and
  `0018_campaign_pools_auto_enrollment`. Later stages add columns only via new migrations — never
  edit an applied migration.
- Rollback: every migration ships a `down`; tested in CI (apply → down → apply).
