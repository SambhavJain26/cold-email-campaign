-- Restore the INBOX cursor onto the retained column before dropping the table,
-- so a rollback does not lose polling position and re-ingest history.
UPDATE mailboxes m
   SET last_poll_uid = c.last_poll_uid
  FROM mailbox_poll_cursors c
 WHERE c.mailbox_id = m.id AND c.folder = 'INBOX';

COMMENT ON COLUMN mailboxes.last_poll_uid IS NULL;
ALTER TABLE mailboxes DROP COLUMN IF EXISTS poll_folders;
DROP TABLE IF EXISTS mailbox_poll_cursors;
