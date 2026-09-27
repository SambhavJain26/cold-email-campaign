ALTER TABLE sent_messages DROP COLUMN email_format;
ALTER TABLE compliance_settings
  DROP COLUMN email_format,
  ALTER COLUMN signature_role_line SET DEFAULT 'Automation Specialist | Sambhav Builds';
-- Preserve operator-owned role wording on rollback.
