CREATE TABLE IF NOT EXISTS incoming_reply_candidates (
  incoming_message_id bigint NOT NULL REFERENCES incoming_messages(id),
  enrollment_id bigint NOT NULL REFERENCES enrollments(id),
  sent_message_id text NOT NULL REFERENCES sent_messages(message_id),
  subject_match boolean NOT NULL,
  company_match boolean NOT NULL,
  policy_version text NOT NULL DEFAULT 'possible_v1',
  PRIMARY KEY (incoming_message_id,enrollment_id),
  CHECK (subject_match OR company_match)
);
CREATE INDEX IF NOT EXISTS reply_candidates_enrollment ON incoming_reply_candidates(enrollment_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON incoming_reply_candidates TO app_rw;
