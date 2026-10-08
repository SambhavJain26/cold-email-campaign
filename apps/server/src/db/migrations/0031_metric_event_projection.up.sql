-- Native columns let PostgreSQL push filters into this analytics projection.
-- Avoid JSON serialization of every ledger row in correlated analytics queries.
CREATE OR REPLACE FUNCTION metric_events_at(cutoff timestamptz DEFAULT NULL)
RETURNS SETOF events LANGUAGE sql STABLE AS $$
  SELECT e.id,
    CASE WHEN e.type='address_suppressed' AND e.attributes->>'rule'='explicit_optout' THEN 'unsubscribe'::event_type ELSE e.type END,
    e.occurred_at,e.lead_id,e.enrollment_id,e.campaign_id,e.step_no,e.mailbox_id,e.message_id,e.sentiment,e.source,e.reason,e.attributes,e.created_at
  FROM events e WHERE e.type<>'incoming_authorship_confirmed' AND (cutoff IS NULL OR e.occurred_at<=cutoff)
  UNION ALL
  SELECT latest.id,'human_reply'::event_type,latest.occurred_at,latest.lead_id,latest.enrollment_id,latest.campaign_id,latest.step_no,latest.mailbox_id,
    latest.message_id,latest.sentiment,latest.source,latest.reason,latest.attributes,latest.created_at
  FROM (
    SELECT DISTINCT ON (attributes->>'incoming_message_id') e.* FROM events e
    WHERE e.type='incoming_authorship_confirmed' AND (cutoff IS NULL OR e.occurred_at<=cutoff)
    ORDER BY attributes->>'incoming_message_id',id DESC
  ) latest JOIN incoming_messages im ON im.id=(latest.attributes->>'incoming_message_id')::bigint
  WHERE latest.attributes->>'authorship'='human' AND im.policy_version<>'legacy' AND im.canonical_id IS NULL
    AND latest.enrollment_id=CASE WHEN cutoff IS NULL THEN im.primary_enrollment_id ELSE
      COALESCE((SELECT (a.attributes->>'primary_enrollment_id')::bigint FROM incoming_message_activity a
        WHERE a.incoming_message_id=im.id AND a.kind='linked' AND a.occurred_at<=cutoff ORDER BY a.id DESC LIMIT 1),
        CASE WHEN NOT EXISTS(SELECT 1 FROM incoming_message_activity a WHERE a.incoming_message_id=im.id AND a.kind='linked' AND a.occurred_at<=cutoff)
          THEN im.matched_enrollment_id END) END;
$$;
