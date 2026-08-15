ALTER TABLE settings
  DROP COLUMN IF EXISTS max_mailbox_daily_cap,
  DROP COLUMN IF EXISTS max_ramp_daily_enroll_cap,
  DROP COLUMN IF EXISTS min_ramp_days;
