DROP TABLE IF EXISTS personalized_copy_blockers;

ALTER TABLE sent_messages
  DROP COLUMN IF EXISTS personalized_copy_id,
  DROP COLUMN IF EXISTS content_source,
  DROP COLUMN IF EXISTS rendered_body_html,
  DROP COLUMN IF EXISTS rendered_body_text,
  DROP COLUMN IF EXISTS rendered_subject;

DROP INDEX IF EXISTS campaign_personalized_copies_one_step;

ALTER TABLE campaign_personalized_copies
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS source_copy_id,
  DROP COLUMN IF EXISTS sequence_step_id;

ALTER INDEX IF EXISTS campaign_personalized_copies_one_unsent
  RENAME TO manual_campaign_drafts_one_unsent;
ALTER INDEX IF EXISTS campaign_personalized_copies_campaign_status
  RENAME TO manual_campaign_drafts_campaign_status;
ALTER TABLE campaign_personalized_copies RENAME TO manual_campaign_drafts;
ALTER TABLE manual_campaign_drafts
  ADD CONSTRAINT manual_campaign_drafts_step_no_check CHECK (step_no = 1);

DROP TABLE IF EXISTS personalized_copy_sources;

ALTER TABLE sequence_steps DROP COLUMN IF EXISTS content_source;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_current_tier_0019;
UPDATE leads l
   SET tier = b.previous_tier
  FROM lead_tier_0019_backup b
 WHERE b.lead_id = l.id;

ALTER TABLE leads DROP COLUMN IF EXISTS outreach_status;
DROP TABLE IF EXISTS lead_tier_0019_backup;
