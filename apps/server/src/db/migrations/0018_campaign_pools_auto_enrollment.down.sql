DROP TRIGGER IF EXISTS campaigns_pool_configuration_guard ON campaigns;
DROP FUNCTION IF EXISTS guard_campaign_pool_configuration();
DROP TABLE IF EXISTS auto_enrollment_state;
DROP TABLE IF EXISTS auto_enrollment_run_campaigns;
DROP TABLE IF EXISTS auto_enrollment_runs;
DROP TABLE IF EXISTS auto_enrollment_days;
DROP TABLE IF EXISTS campaign_lead_pool;
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_steady_cap_positive,
  DROP COLUMN IF EXISTS steady_daily_enroll_cap,
  DROP COLUMN IF EXISTS auto_enroll_enabled,
  DROP COLUMN IF EXISTS lead_selection_mode;
