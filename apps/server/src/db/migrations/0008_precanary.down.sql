DROP INDEX IF EXISTS leads_not_erased;
ALTER TABLE leads DROP COLUMN erased_at;
ALTER TABLE leads DROP COLUMN is_erased;
ALTER TABLE mailboxes DROP COLUMN timezone;
