ALTER TABLE compliance_settings ADD COLUMN IF NOT EXISTS include_postal_address boolean NOT NULL DEFAULT false;
ALTER TABLE compliance_settings ALTER COLUMN signature_role_line SET DEFAULT 'Property Management Automation Specialist';
-- Change the previous application default, preserving customized operator roles.
UPDATE compliance_settings SET signature_role_line = 'Property Management Automation Specialist'
WHERE signature_role_line = 'PM Systems & Automation Specialist';
