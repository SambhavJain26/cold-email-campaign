-- In-app operator reminders. These are mutable operational tasks, not domain
-- facts: completing one neither changes enrollment state nor grants permission
-- to contact a lead.
CREATE TABLE operator_reminders (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id        bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  incoming_message_id  bigint REFERENCES incoming_messages(id) ON DELETE SET NULL,
  due_date              date NOT NULL,
  note                  text,
  source                text NOT NULL CHECK (source IN ('manual','not_now','legacy_snooze')),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX operator_reminders_open_due
  ON operator_reminders (due_date, id)
  WHERE status = 'open';

CREATE UNIQUE INDEX operator_reminders_not_now_reply
  ON operator_reminders (incoming_message_id)
  WHERE source = 'not_now' AND incoming_message_id IS NOT NULL;

-- Old reply-card snoozes had two meanings. Preserve ACTIVE enrollment snoozes
-- for scheduler compatibility, but turn future snoozes on replied enrollments
-- into visible reminders and remove their obsolete scheduling value.
INSERT INTO operator_reminders (
  enrollment_id, incoming_message_id, due_date, source, status, created_at, updated_at
)
SELECT e.id,
       reply.id,
       (e.snoozed_until AT TIME ZONE s.default_timezone)::date,
       'legacy_snooze',
       'open',
       now(),
       now()
  FROM enrollments e
 CROSS JOIN settings s
  LEFT JOIN LATERAL (
    SELECT im.id
      FROM incoming_messages im
     WHERE im.matched_enrollment_id = e.id
       AND im.classification = 'human_reply'
     ORDER BY im.received_at DESC NULLS LAST, im.id DESC
     LIMIT 1
  ) reply ON true
 WHERE e.current_state = 'REPLIED'
   AND e.snoozed_until > now();

UPDATE enrollments
   SET snoozed_until = NULL
 WHERE current_state = 'REPLIED'
   AND snoozed_until IS NOT NULL;
