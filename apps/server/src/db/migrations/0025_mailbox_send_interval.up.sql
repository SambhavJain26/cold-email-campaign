-- Existing mailboxes retain their pacing until the operator saves an interval.
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS send_interval_minutes integer
  CHECK (send_interval_minutes BETWEEN 1 AND 1440);
