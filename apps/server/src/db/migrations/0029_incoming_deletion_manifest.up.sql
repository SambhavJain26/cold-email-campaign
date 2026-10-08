ALTER TABLE settings ADD COLUMN IF NOT EXISTS incoming_identity_epoch text NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE sent_messages ADD COLUMN IF NOT EXISTS conversation_root_id text;
