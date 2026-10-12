ALTER TABLE sequences ADD COLUMN IF NOT EXISTS wait_day_mode text NOT NULL DEFAULT 'elapsed_days'
  CHECK (wait_day_mode IN ('elapsed_days', 'business_days'));
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'schedule_recalculated';
-- Durable receipts make apply idempotent even when no enrollment dates change.
CREATE TABLE IF NOT EXISTS sequence_schedule_operations (
  operation_id text PRIMARY KEY,
  sequence_id bigint NOT NULL REFERENCES sequences(id),
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='schedule_operations_no_mutation') THEN
    CREATE TRIGGER schedule_operations_no_mutation BEFORE UPDATE OR DELETE ON sequence_schedule_operations
      FOR EACH ROW EXECUTE FUNCTION events_immutable();
  END IF;
END $$;
REVOKE UPDATE, DELETE ON sequence_schedule_operations FROM app_rw;
GRANT SELECT, INSERT ON sequence_schedule_operations TO app_rw;
