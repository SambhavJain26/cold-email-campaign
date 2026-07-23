-- 0006_ops: alerts (docs/03 §3). Applied before 0005_ingest lands (B5.1) -
-- the runner applies pending migrations in filename order; nothing here
-- depends on ingest tables. (The operator table arrives in 0007 - it was
-- deliberately NOT part of 0002; see that file's header.)

CREATE TYPE alert_severity AS ENUM ('info','warning','error');

CREATE TABLE alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  severity alert_severity NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_unacked ON alerts (created_at DESC) WHERE acknowledged_at IS NULL;
