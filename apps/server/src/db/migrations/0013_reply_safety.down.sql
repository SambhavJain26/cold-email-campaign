-- Safe only before reply_dispositioned facts exist. The cast deliberately
-- refuses rollback rather than deleting append-only history.
DROP TRIGGER IF EXISTS settings_delivery_confirm_window_immutable ON settings;
DROP FUNCTION IF EXISTS prevent_delivery_confirm_window_rewrite();

ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_stop_on_reply_required;

ALTER TYPE event_type RENAME TO event_type_with_reply_disposition;
CREATE TYPE event_type AS ENUM (
  'enrolled','sent','delivered','soft_bounce','hard_bounce',
  'human_reply','auto_reply','unsubscribe','meeting_booked',
  'deal_won','deal_lost','sentiment_tagged'
);
DROP INDEX ev_campaign;
DROP INDEX ev_mailbox;
DROP INDEX ev_sent_message_id;
ALTER TABLE events
  ALTER COLUMN type TYPE event_type USING type::text::event_type;
CREATE INDEX ev_campaign ON events (campaign_id, type);
CREATE INDEX ev_mailbox ON events (mailbox_id, type, occurred_at);
CREATE UNIQUE INDEX ev_sent_message_id ON events (message_id) WHERE type = 'sent';
DROP TYPE event_type_with_reply_disposition;
GRANT USAGE ON TYPE event_type TO app_rw;
