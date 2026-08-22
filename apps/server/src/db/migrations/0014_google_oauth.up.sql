-- Per-mailbox Google OAuth credentials. Refresh tokens and PKCE verifiers are
-- sealed with SECRET_KEY; authorization state is stored only as a SHA-256 hash.
ALTER TYPE mailbox_status ADD VALUE IF NOT EXISTS 'setup_required';

CREATE TABLE mailbox_oauth_credentials (
  mailbox_id          bigint PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
  sealed_refresh_token bytea NOT NULL,
  granted_email       text NOT NULL,
  scopes              text[] NOT NULL DEFAULT '{}',
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailbox_oauth_states (
  state_hash          text PRIMARY KEY,
  mailbox_id          bigint NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sealed_code_verifier bytea NOT NULL,
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz
);
CREATE INDEX mailbox_oauth_states_expiry ON mailbox_oauth_states (expires_at);

GRANT USAGE ON TYPE mailbox_status TO app_rw;
