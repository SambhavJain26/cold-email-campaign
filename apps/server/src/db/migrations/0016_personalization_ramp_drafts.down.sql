DROP TRIGGER IF EXISTS campaigns_freeze_configuration ON campaigns;
DROP FUNCTION IF EXISTS freeze_campaign_configuration();
DROP TABLE IF EXISTS manual_campaign_drafts;
ALTER TABLE campaigns
  DROP COLUMN IF EXISTS ramp_stages,
  DROP COLUMN IF EXISTS first_activated_at,
  DROP COLUMN IF EXISTS auto_observation_rules,
  DROP COLUMN IF EXISTS auto_observation_field,
  DROP COLUMN IF EXISTS resolved_variables,
  DROP COLUMN IF EXISTS variable_overrides;
ALTER TABLE sequences DROP COLUMN IF EXISTS variable_defaults;
