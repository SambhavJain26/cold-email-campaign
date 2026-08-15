-- Poll more than INBOX (finding 13).
--
-- The poller read INBOX only, so a reply that a provider spam-filed was
-- invisible — indistinguishable from a broken poller, and the single most
-- confusing production failure mode this system has.
--
-- IMAP UIDs are scoped to a FOLDER, not a mailbox: UID 42 in INBOX and UID 42
-- in Spam are unrelated messages. So one high-water mark cannot span folders,
-- and this replaces mailboxes.last_poll_uid with a cursor per (mailbox, folder).
CREATE TABLE mailbox_poll_cursors (
  mailbox_id    bigint NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  folder        text   NOT NULL,
  last_poll_uid bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (mailbox_id, folder)
);

-- Provider folder names differ ("[Gmail]/Spam" vs "Junk" vs "Junk E-Mail"), so
-- this is configuration, never a constant. INBOX-only stays the default: adding
-- a folder is an explicit operator decision, because each new folder starts
-- from its own UIDNEXT and a mistake there re-ingests history (finding 16).
ALTER TABLE mailboxes ADD COLUMN poll_folders text[] NOT NULL DEFAULT '{INBOX}';

-- Carry every existing high-water mark across as that mailbox's INBOX cursor.
-- Skipping this would reset every mailbox to 0 and re-ingest its entire
-- history on the next poll — exactly the bug finding 16 fixed.
INSERT INTO mailbox_poll_cursors (mailbox_id, folder, last_poll_uid)
SELECT id, 'INBOX', last_poll_uid FROM mailboxes
ON CONFLICT (mailbox_id, folder) DO NOTHING;

-- mailboxes.last_poll_uid is deliberately RETAINED, not dropped: it is the
-- rollback path for the backfill above, and dropping a column with live data
-- to save a few bytes is a bad trade.
COMMENT ON COLUMN mailboxes.last_poll_uid IS
  'Superseded by mailbox_poll_cursors (0012). Retained so the migration is reversible.';
