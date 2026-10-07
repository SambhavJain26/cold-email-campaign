-- The legacy interval remains available to rollback code. All current mailboxes
-- adopt the operator-requested range; deadlines are drawn only on first apply.
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS send_interval_min_minutes integer DEFAULT 4;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS send_interval_max_minutes integer DEFAULT 7;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS next_allowed_send_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_send_range_valid') THEN
    ALTER TABLE mailboxes ADD CONSTRAINT mailbox_send_range_valid CHECK (
      (send_interval_min_minutes IS NULL AND send_interval_max_minutes IS NULL) OR
      (send_interval_min_minutes IS NOT NULL AND send_interval_max_minutes IS NOT NULL AND
       send_interval_min_minutes BETWEEN 1 AND 1440 AND send_interval_max_minutes BETWEEN 1 AND 1440 AND
       send_interval_min_minutes < send_interval_max_minutes)
    );
    UPDATE mailboxes SET next_allowed_send_at = last_send_at +
      (240 + floor(random() * 181)) * interval '1 second'
    WHERE last_send_at IS NOT NULL AND next_allowed_send_at IS NULL;
  END IF;
END $$;
