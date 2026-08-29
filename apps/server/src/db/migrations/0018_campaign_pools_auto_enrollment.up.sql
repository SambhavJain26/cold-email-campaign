-- Campaign-scoped lead pools, opt-in automatic daily enrollment, and a
-- permanent campaign enrollment cap after the activation ramp ends.

ALTER TABLE campaigns
  ADD COLUMN lead_selection_mode text NOT NULL DEFAULT 'global'
    CHECK (lead_selection_mode IN ('global','pool')),
  ADD COLUMN auto_enroll_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN steady_daily_enroll_cap int;

UPDATE campaigns
   SET steady_daily_enroll_cap = COALESCE(
         (
           SELECT (stage->>'cap')::int
             FROM jsonb_array_elements(ramp_stages) AS stage
            ORDER BY (stage->>'end_day')::int DESC
            LIMIT 1
         ),
         15
       );

ALTER TABLE campaigns
  ALTER COLUMN steady_daily_enroll_cap SET NOT NULL,
  ALTER COLUMN steady_daily_enroll_cap SET DEFAULT 15,
  ADD CONSTRAINT campaigns_steady_cap_positive CHECK (steady_daily_enroll_cap >= 1);

CREATE TABLE campaign_lead_pool (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id          bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id              bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_import_id     bigint REFERENCES imports(id) ON DELETE SET NULL,
  allocation_order     bigint NOT NULL,
  status               text NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available','enrolled','released')),
  enrollment_id        bigint REFERENCES enrollments(id) ON DELETE SET NULL,
  last_eligibility_reason text,
  last_checked_at      timestamptz,
  allocated_at         timestamptz NOT NULL DEFAULT now(),
  enrolled_at          timestamptz,
  released_at          timestamptz,
  UNIQUE (campaign_id, lead_id)
);

CREATE UNIQUE INDEX campaign_lead_pool_one_available_campaign
  ON campaign_lead_pool (lead_id)
  WHERE status = 'available';
CREATE INDEX campaign_lead_pool_campaign_status_order
  ON campaign_lead_pool (campaign_id, status, allocation_order, id);
CREATE INDEX campaign_lead_pool_source_import
  ON campaign_lead_pool (source_import_id, campaign_id)
  WHERE source_import_id IS NOT NULL;

CREATE TABLE auto_enrollment_days (
  local_date            date PRIMARY KEY,
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','completed','failed')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  error                  text
);

CREATE TABLE auto_enrollment_runs (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger               text NOT NULL CHECK (trigger IN ('daily','enabled','activation','resume')),
  local_date            date NOT NULL,
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','completed','failed')),
  capacity_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_served_campaign_id bigint REFERENCES campaigns(id) ON DELETE SET NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  error                 text
);

CREATE INDEX auto_enrollment_runs_date ON auto_enrollment_runs (local_date, id DESC);

CREATE TABLE auto_enrollment_run_campaigns (
  run_id                bigint NOT NULL REFERENCES auto_enrollment_runs(id) ON DELETE CASCADE,
  campaign_id           bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  eligible_before       int NOT NULL DEFAULT 0,
  cap_remaining         int NOT NULL DEFAULT 0,
  enrolled              int NOT NULL DEFAULT 0,
  skipped               jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, campaign_id)
);

CREATE TABLE auto_enrollment_state (
  singleton             boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_served_campaign_id bigint REFERENCES campaigns(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auto_enrollment_state (singleton) VALUES (true);

CREATE OR REPLACE FUNCTION guard_campaign_pool_configuration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lead_selection_mode = 'pool' AND NEW.lead_selection_mode <> 'pool' THEN
    RAISE EXCEPTION 'pool-backed campaigns cannot return to global lead selection'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.first_activated_at IS NOT NULL
     AND NEW.steady_daily_enroll_cap > OLD.steady_daily_enroll_cap THEN
    RAISE EXCEPTION 'steady daily enrollment cap cannot increase after first activation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_pool_configuration_guard
BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION guard_campaign_pool_configuration();
