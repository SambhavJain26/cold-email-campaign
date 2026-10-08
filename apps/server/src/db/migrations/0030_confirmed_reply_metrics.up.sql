-- Analytics-only interpretation. The domain ledger and legacy terminal reducer stay unchanged.
CREATE OR REPLACE FUNCTION metric_events_at(cutoff timestamptz DEFAULT NULL)
RETURNS SETOF events LANGUAGE sql STABLE AS $$
  SELECT (jsonb_populate_record(NULL::events, to_jsonb(e) ||
    CASE WHEN e.type='address_suppressed' AND e.attributes->>'rule'='explicit_optout'
      THEN jsonb_build_object('type','unsubscribe') ELSE '{}'::jsonb END)).*
  FROM events e WHERE e.type<>'incoming_authorship_confirmed' AND (cutoff IS NULL OR e.occurred_at<=cutoff)
  UNION ALL
  SELECT (jsonb_populate_record(NULL::events,to_jsonb(latest) || jsonb_build_object('type','human_reply'))).*
  FROM (
    SELECT DISTINCT ON (attributes->>'incoming_message_id') e.* FROM events e
    WHERE e.type='incoming_authorship_confirmed' AND (cutoff IS NULL OR e.occurred_at<=cutoff)
    ORDER BY attributes->>'incoming_message_id',id DESC
  ) latest JOIN incoming_messages im ON im.id=(latest.attributes->>'incoming_message_id')::bigint
  WHERE latest.attributes->>'authorship'='human' AND im.policy_version<>'legacy' AND im.canonical_id IS NULL
    AND latest.enrollment_id=im.primary_enrollment_id;
$$;
