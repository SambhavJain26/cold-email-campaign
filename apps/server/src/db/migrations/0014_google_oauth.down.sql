DROP TABLE IF EXISTS mailbox_oauth_states;
DROP TABLE IF EXISTS mailbox_oauth_credentials;

-- PostgreSQL cannot remove one enum value in place. Refuse no rollback data:
-- a setup-required mailbox remains safely paused if this migration is reverted.
UPDATE mailboxes SET status = 'paused', status_reason = 'Google OAuth migration reverted'
WHERE status = 'setup_required';
ALTER TYPE mailbox_status RENAME TO mailbox_status_with_setup_required;
CREATE TYPE mailbox_status AS ENUM
  ('ok','paused','auto_paused','auth_failed','imap_stale','provider_blocked');
ALTER TABLE mailboxes ALTER COLUMN status DROP DEFAULT;
ALTER TABLE mailboxes
  ALTER COLUMN status TYPE mailbox_status USING status::text::mailbox_status;
ALTER TABLE mailboxes ALTER COLUMN status SET DEFAULT 'ok';
DROP TYPE mailbox_status_with_setup_required;
GRANT USAGE ON TYPE mailbox_status TO app_rw;
