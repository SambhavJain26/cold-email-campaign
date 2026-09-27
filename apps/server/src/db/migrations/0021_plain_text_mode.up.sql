ALTER TABLE compliance_settings
  ADD COLUMN email_format text NOT NULL DEFAULT 'plain_text'
    CHECK (email_format IN ('plain_text', 'minimal_html')),
  ALTER COLUMN signature_role_line SET DEFAULT 'Automation Specialist';

UPDATE compliance_settings SET signature_role_line = 'Automation Specialist'
WHERE signature_role_line = 'Automation Specialist | Sambhav Builds';

-- Existing messages were HTML; preserve their bodies and retry format.
ALTER TABLE sent_messages
  ADD COLUMN email_format text NOT NULL DEFAULT 'minimal_html'
    CHECK (email_format IN ('plain_text', 'minimal_html'));
