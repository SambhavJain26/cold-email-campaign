-- 0004_transport_tables down.
ALTER TABLE enrollments DROP CONSTRAINT enrollments_assigned_mailbox_id_fkey;
ALTER TABLE events DROP CONSTRAINT events_mailbox_id_fkey;

DROP TABLE incoming_messages;
DROP TABLE sent_messages;
DROP TABLE mailbox_secrets;
DROP TABLE mailboxes;

DROP TYPE incoming_class;
DROP TYPE mailbox_status;
