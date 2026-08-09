-- Pre-canary remediation: mailbox-local fallback timezone and privacy erasure.
ALTER TABLE mailboxes ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York';
ALTER TABLE leads ADD COLUMN is_erased boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN erased_at timestamptz;
CREATE INDEX leads_not_erased ON leads (id) WHERE NOT is_erased;
