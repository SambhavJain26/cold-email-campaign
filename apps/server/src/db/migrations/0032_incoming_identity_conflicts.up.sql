-- A conflicting envelope may reuse a Message-ID. Keep both messages visible for linking.
-- Production intake serializes this key and deduplicates equivalent envelopes atomically.
DROP INDEX IF EXISTS im_msgid;
CREATE INDEX im_msgid ON incoming_messages(message_id) WHERE message_id IS NOT NULL;
