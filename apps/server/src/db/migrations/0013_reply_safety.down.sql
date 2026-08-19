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
ALTER TABLE events
  ALTER COLUMN type TYPE event_type USING type::text::event_type;
DROP TYPE event_type_with_reply_disposition;
GRANT USAGE ON TYPE event_type TO app_rw;
