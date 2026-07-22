-- 0002_seed: settings + compliance_settings (single-row tables) with defaults
-- per docs/03 §3 / spec Part 11. The operator row is NOT seeded here - it
-- needs an argon2id hash of OPERATOR_INITIAL_PASSWORD, so it's created at
-- first boot (B6.1), not in pure SQL.

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
  delivery_confirm_hours int NOT NULL DEFAULT 6,
  send_jitter_pct int NOT NULL DEFAULT 20,
  default_timezone text NOT NULL DEFAULT 'America/New_York',
  cold_storage_rest_days int NOT NULL DEFAULT 60,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_settings (
  id int PRIMARY KEY CHECK (id = 1),
  physical_address text NOT NULL DEFAULT '',
  optout_text text NOT NULL DEFAULT 'Don''t want future emails? Reply STOP and I''ll remove you immediately.',
  from_name_rules text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (id) VALUES (1);
INSERT INTO compliance_settings (id) VALUES (1);
