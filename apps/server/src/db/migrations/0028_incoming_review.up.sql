ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'incoming_review_required';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'outreach_review_decided';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'sequence_stopped';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'sequence_restored';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'incoming_authorship_confirmed';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'address_suppressed';

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS review_hold_ids bigint[] NOT NULL DEFAULT '{}';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS review_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS delayed_until timestamptz;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS resume_due_at timestamptz;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS manual_stop_event_id bigint;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS incoming_content_retention_days int DEFAULT 30
  CHECK (incoming_content_retention_days BETWEEN 1 AND 3650);
ALTER TABLE mailbox_poll_cursors ADD COLUMN IF NOT EXISTS uid_validity text;
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS automation text NOT NULL DEFAULT 'uncertain';
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'unmatched';
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS review_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS canonical_id bigint REFERENCES incoming_messages(id);
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS primary_enrollment_id bigint REFERENCES enrollments(id);
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS linking_status text NOT NULL DEFAULT 'needs_linking';
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS content_deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS incoming_message_locations (
  mailbox_id bigint NOT NULL REFERENCES mailboxes(id), folder text NOT NULL,
  uid_validity text NOT NULL, imap_uid bigint NOT NULL,
  incoming_message_id bigint NOT NULL REFERENCES incoming_messages(id),
  PRIMARY KEY (mailbox_id, folder, uid_validity, imap_uid)
);
-- Legacy locations are unknown. Keep old identifiers, never invent a folder.
ALTER TABLE incoming_messages DROP CONSTRAINT IF EXISTS incoming_messages_mailbox_id_imap_uid_key;
CREATE TABLE IF NOT EXISTS incoming_message_content (
  incoming_message_id bigint PRIMARY KEY REFERENCES incoming_messages(id),
  body_text text, body_html text, new_text text, quoted_text text, snippet text,
  capture_status text NOT NULL CHECK (capture_status IN ('captured','legacy_preview','oversized','unavailable','deleted'))
);
INSERT INTO incoming_message_content (incoming_message_id, body_text, snippet, capture_status)
SELECT id, body_text, snippet, CASE WHEN body_text IS NOT NULL THEN 'captured' ELSE 'legacy_preview' END
FROM incoming_messages ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS incoming_message_links (
  incoming_message_id bigint NOT NULL REFERENCES incoming_messages(id),
  lead_id bigint NOT NULL REFERENCES leads(id), campaign_id bigint NOT NULL REFERENCES campaigns(id),
  enrollment_id bigint REFERENCES enrollments(id), matching_method text NOT NULL,
  acknowledged_at timestamptz, PRIMARY KEY (incoming_message_id, lead_id, campaign_id)
);
INSERT INTO incoming_message_links (incoming_message_id, lead_id, campaign_id, enrollment_id, matching_method)
SELECT im.id,e.lead_id,e.campaign_id,e.id,'legacy' FROM incoming_messages im
JOIN enrollments e ON e.id=im.matched_enrollment_id ON CONFLICT DO NOTHING;
UPDATE incoming_messages SET primary_enrollment_id=matched_enrollment_id,
  linking_status='linked', relationship='in_thread',
  automation=CASE WHEN classification='auto_reply' THEN 'automatic' ELSE 'uncertain' END
WHERE matched_enrollment_id IS NOT NULL AND policy_version='legacy';
CREATE TABLE IF NOT EXISTS incoming_message_activity (
  id bigserial PRIMARY KEY, incoming_message_id bigint REFERENCES incoming_messages(id),
  operation_id text NOT NULL, kind text NOT NULL, enrollment_id bigint,
  attributes jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL,
  UNIQUE(operation_id,incoming_message_id,kind)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='incoming_activity_no_mutation') THEN
    CREATE TRIGGER incoming_activity_no_mutation BEFORE UPDATE OR DELETE ON incoming_message_activity
    FOR EACH ROW EXECUTE FUNCTION events_immutable();
  END IF;
END $$;
REVOKE UPDATE, DELETE ON incoming_message_activity FROM app_rw;
CREATE INDEX IF NOT EXISTS im_links_row ON incoming_message_links(campaign_id,lead_id);
CREATE INDEX IF NOT EXISTS im_activity_message ON incoming_message_activity(incoming_message_id,id);
