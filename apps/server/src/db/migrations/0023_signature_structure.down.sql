-- Preserve operator configuration and immutable sent snapshots on rollback.
ALTER TABLE compliance_settings ALTER COLUMN signature_role_line SET DEFAULT 'Automation Specialist';
ALTER TABLE compliance_settings ALTER COLUMN physical_address SET DEFAULT '';
