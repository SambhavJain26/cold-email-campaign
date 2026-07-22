-- 0003_sequences: sequences, sequence_steps, step_variants (docs/03 §3)
-- + the campaigns.sequence_id FK deferred from 0001 (same pattern as 0004's
-- deferred FKs). Lands AFTER 0004/0006 by filename-order backfill: the runner
-- applies pending migrations in filename order and neither depends on these.

CREATE TABLE sequences (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  text NOT NULL,
  stop_on_reply         bool NOT NULL DEFAULT true,
  stop_on_hard_bounce   bool NOT NULL DEFAULT true,
  stop_on_unsubscribe   bool NOT NULL DEFAULT true,
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
  label            text NOT NULL,              -- 'A','B',…
  subject_template text NOT NULL,
  body_template    text NOT NULL,              -- footer NOT stored here (appended at render)
  active           bool NOT NULL DEFAULT true,
  content_hash     text NOT NULL,              -- sha256(subject||'\0'||body), recomputed on save (decision Q)
  attributes       jsonb NOT NULL DEFAULT '{}', -- {"bespoke":true} = Mode-1 one-off variant (docs/08 §3)
  UNIQUE (step_id, label)
);

-- FK deferred from 0001 (campaigns.sequence_id existed as plain bigint).
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_sequence_id_fkey
  FOREIGN KEY (sequence_id) REFERENCES sequences(id);
