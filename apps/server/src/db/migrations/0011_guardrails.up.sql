-- Hard launch guardrails (docs/16 s8 item 2). Ceilings on what an operator can
-- CONFIGURE, so a typo cannot create an unsafe first-day volume. These are
-- deliberately settings rather than constants: the safe number changes as
-- domains warm, and the operator must be able to raise it consciously.
--
-- They bound configuration, not reputation. Warming is still operator work.
ALTER TABLE settings
  ADD COLUMN max_mailbox_daily_cap int NOT NULL DEFAULT 50,
  ADD COLUMN max_ramp_daily_enroll_cap int NOT NULL DEFAULT 25,
  -- 0 = staged enrollment not enforced. Deliberately the default so this
  -- migration cannot retroactively invalidate existing campaigns; the
  -- domain-readiness preflight flags a 0 as not-launch-ready.
  ADD COLUMN min_ramp_days int NOT NULL DEFAULT 0;
