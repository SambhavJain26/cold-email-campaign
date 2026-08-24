-- Stage 2: imported manual drafts, namespaced sequence variables, configurable
-- Auto Observation rules, and activation-based staged campaign ramps.

ALTER TABLE sequences
  ADD COLUMN variable_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE campaigns
  ADD COLUMN variable_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN resolved_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN auto_observation_field text,
  ADD COLUMN auto_observation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN first_activated_at timestamptz,
  ADD COLUMN ramp_stages jsonb NOT NULL DEFAULT '[
    {"start_day":1,"end_day":1,"cap":5},
    {"start_day":2,"end_day":2,"cap":8},
    {"start_day":3,"end_day":3,"cap":10},
    {"start_day":4,"end_day":4,"cap":12},
    {"start_day":5,"end_day":7,"cap":15}
  ]'::jsonb;

-- Preserve the old flat-ramp behaviour for existing rows. Non-drafts used
-- created_at as their historical origin and keep doing so after migration.
UPDATE campaigns
   SET ramp_stages = CASE
         WHEN COALESCE((ramp_config->>'ramp_days')::int, 0) > 0 THEN
           jsonb_build_array(jsonb_build_object(
             'start_day', 1,
             'end_day', (ramp_config->>'ramp_days')::int,
             'cap', (ramp_config->>'ramp_daily_enroll_cap')::int
           ))
         ELSE '[]'::jsonb
       END,
       first_activated_at = CASE WHEN status = 'draft' THEN NULL ELSE created_at END;

-- Existing active/paused/archived campaigns get a frozen snapshot now. Draft
-- campaigns snapshot defaults plus overrides atomically on first activation.
UPDATE campaigns c
   SET resolved_variables = COALESCE(s.variable_defaults, '{}'::jsonb) || c.variable_overrides
  FROM sequences s
 WHERE c.sequence_id = s.id
   AND c.status <> 'draft';

CREATE TABLE manual_campaign_drafts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id        bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id    bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_no        int NOT NULL DEFAULT 1 CHECK (step_no = 1),
  source_import_id bigint REFERENCES imports(id) ON DELETE SET NULL,
  subject        text NOT NULL,
  body           text NOT NULL,
  status         text NOT NULL DEFAULT 'needs_review'
                   CHECK (status IN ('needs_review','ready','sent')),
  sent_event_id  bigint REFERENCES events(id),
  sent_message_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);

CREATE UNIQUE INDEX manual_campaign_drafts_one_unsent
  ON manual_campaign_drafts (lead_id, campaign_id, step_no)
  WHERE status <> 'sent';
CREATE INDEX manual_campaign_drafts_campaign_status
  ON manual_campaign_drafts (campaign_id, status, id);

CREATE OR REPLACE FUNCTION freeze_campaign_configuration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.first_activated_at IS NOT NULL AND (
         NEW.tier_effort_config IS DISTINCT FROM OLD.tier_effort_config OR
         NEW.variable_overrides IS DISTINCT FROM OLD.variable_overrides OR
         NEW.resolved_variables IS DISTINCT FROM OLD.resolved_variables OR
         NEW.auto_observation_field IS DISTINCT FROM OLD.auto_observation_field OR
         NEW.auto_observation_rules IS DISTINCT FROM OLD.auto_observation_rules OR
         NEW.ramp_stages IS DISTINCT FROM OLD.ramp_stages OR
         NEW.first_activated_at IS DISTINCT FROM OLD.first_activated_at
       ) THEN
      RAISE EXCEPTION 'campaign personalization and ramp configuration is immutable after first activation'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.first_activated_at IS NULL AND NEW.status = 'active' THEN
      NEW.first_activated_at := COALESCE(NEW.first_activated_at, NEW.created_at, now());
      SELECT COALESCE(s.variable_defaults, '{}'::jsonb) || NEW.variable_overrides
        INTO NEW.resolved_variables
        FROM sequences s
       WHERE s.id = NEW.sequence_id;
      NEW.resolved_variables := COALESCE(NEW.resolved_variables, NEW.variable_overrides, '{}'::jsonb);
    END IF;
  ELSIF NEW.status = 'active' THEN
    NEW.first_activated_at := COALESCE(NEW.first_activated_at, NEW.created_at, now());
    SELECT COALESCE(s.variable_defaults, '{}'::jsonb) || NEW.variable_overrides
      INTO NEW.resolved_variables
      FROM sequences s
     WHERE s.id = NEW.sequence_id;
    NEW.resolved_variables := COALESCE(NEW.resolved_variables, NEW.variable_overrides, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_freeze_configuration
BEFORE INSERT OR UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION freeze_campaign_configuration();
