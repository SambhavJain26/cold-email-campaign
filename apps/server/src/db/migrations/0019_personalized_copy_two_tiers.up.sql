-- Sequence-only personalized copy, current two-tier leads, rendered-message
-- snapshots, and durable missing-copy blockers.

CREATE TABLE lead_tier_0019_backup (
  lead_id bigint PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  previous_tier lead_tier NOT NULL
);

INSERT INTO lead_tier_0019_backup (lead_id, previous_tier)
SELECT id, tier FROM leads WHERE tier IN ('C', 'nurture');

ALTER TABLE leads
  ADD COLUMN outreach_status text NOT NULL DEFAULT 'standard'
    CHECK (outreach_status IN ('standard', 'nurture'));

UPDATE leads SET outreach_status = 'nurture', tier = NULL WHERE tier = 'nurture';
UPDATE leads SET tier = 'B' WHERE tier = 'C';

ALTER TABLE leads
  ADD CONSTRAINT leads_current_tier_0019
  CHECK (tier IS NULL OR tier IN ('A', 'B'));

ALTER TABLE sequence_steps
  ADD COLUMN content_source text NOT NULL DEFAULT 'template'
    CHECK (content_source IN ('template', 'personalized'));

CREATE TABLE personalized_copy_sources (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id          bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  slot_no          int NOT NULL DEFAULT 1 CHECK (slot_no >= 1),
  target_step_no   int CHECK (target_step_no IS NULL OR target_step_no >= 1),
  source_import_id bigint REFERENCES imports(id) ON DELETE SET NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'needs_review'
                     CHECK (status IN ('needs_review', 'ready')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, slot_no)
);

CREATE INDEX personalized_copy_sources_import
  ON personalized_copy_sources (source_import_id, slot_no)
  WHERE source_import_id IS NOT NULL;

ALTER TABLE manual_campaign_drafts RENAME TO campaign_personalized_copies;

ALTER TABLE campaign_personalized_copies
  DROP CONSTRAINT IF EXISTS manual_campaign_drafts_step_no_check,
  ADD COLUMN sequence_step_id bigint REFERENCES sequence_steps(id) ON DELETE RESTRICT,
  ADD COLUMN source_copy_id bigint REFERENCES personalized_copy_sources(id) ON DELETE SET NULL,
  ADD COLUMN content_hash text;

UPDATE campaign_personalized_copies c
   SET sequence_step_id = ss.id
  FROM campaigns ca
  JOIN sequence_steps ss ON ss.sequence_id = ca.sequence_id
 WHERE ca.id = c.campaign_id
   AND ss.step_no = c.step_no;

ALTER INDEX IF EXISTS manual_campaign_drafts_one_unsent
  RENAME TO campaign_personalized_copies_one_unsent;
ALTER INDEX IF EXISTS manual_campaign_drafts_campaign_status
  RENAME TO campaign_personalized_copies_campaign_status;

CREATE UNIQUE INDEX campaign_personalized_copies_one_step
  ON campaign_personalized_copies (lead_id, campaign_id, sequence_step_id)
  WHERE sequence_step_id IS NOT NULL;

ALTER TABLE sent_messages
  ADD COLUMN rendered_subject text,
  ADD COLUMN rendered_body_text text,
  ADD COLUMN rendered_body_html text,
  ADD COLUMN content_source text CHECK (content_source IN ('template', 'personalized')),
  ADD COLUMN personalized_copy_id bigint REFERENCES campaign_personalized_copies(id) ON DELETE SET NULL;

CREATE TABLE personalized_copy_blockers (
  enrollment_id   bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  sequence_step_id bigint NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  campaign_id     bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id         bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  reason          text NOT NULL CHECK (reason IN ('missing', 'needs_review', 'invalid_copy', 'content_conflict')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, sequence_step_id)
);

CREATE INDEX personalized_copy_blockers_campaign
  ON personalized_copy_blockers (campaign_id, sequence_step_id, reason);
