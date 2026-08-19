-- Reply safety (decisions AA-AC): dispositions are append-only facts and
-- every sequence must stop after a human reply.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'reply_dispositioned';

UPDATE sequences SET stop_on_reply = true WHERE stop_on_reply = false;
ALTER TABLE sequences
  ADD CONSTRAINT sequences_stop_on_reply_required CHECK (stop_on_reply = true);

-- Finding 24: a replay-affecting completion window is immutable once the
-- append-only ledger contains a send. The trigger closes API/worker races.
CREATE OR REPLACE FUNCTION prevent_delivery_confirm_window_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.delivery_confirm_hours IS DISTINCT FROM OLD.delivery_confirm_hours
     AND EXISTS (SELECT 1 FROM events WHERE type = 'sent' LIMIT 1) THEN
    RAISE EXCEPTION 'delivery_confirm_hours is immutable after the first send'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settings_delivery_confirm_window_immutable
BEFORE UPDATE OF delivery_confirm_hours ON settings
FOR EACH ROW EXECUTE FUNCTION prevent_delivery_confirm_window_rewrite();
