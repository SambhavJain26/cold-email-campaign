ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'outreach_stopped';
ALTER TYPE enrollment_state ADD VALUE IF NOT EXISTS 'STOPPED';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS incoming_stop_since timestamptz NOT NULL DEFAULT now();
