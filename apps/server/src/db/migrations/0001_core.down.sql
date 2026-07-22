-- 0001_core down. The app_rw role is cluster-wide (shared by the dev and
-- test databases in one Postgres instance) and is intentionally NOT dropped;
-- its per-database privileges die with the tables.
DROP TRIGGER events_no_mutation ON events;
DROP FUNCTION events_immutable();

DROP TABLE suppressions;
DROP TABLE events;
DROP TABLE enrollments;
DROP TABLE campaigns;
DROP TABLE leads;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM app_rw;

DROP TYPE campaign_status;
DROP TYPE unsubscribe_source;
DROP TYPE personalization_mode;
DROP TYPE suppression_reason;
DROP TYPE lead_tier;
DROP TYPE sentiment;
DROP TYPE enrollment_state;
DROP TYPE event_type;
