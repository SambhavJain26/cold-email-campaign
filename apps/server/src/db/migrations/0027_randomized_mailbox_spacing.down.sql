-- Keep configured ranges and persisted deadlines; older code uses the retained
-- send_interval_minutes column. Rollback/reapply must not redraw a deadline.
SELECT 1;
