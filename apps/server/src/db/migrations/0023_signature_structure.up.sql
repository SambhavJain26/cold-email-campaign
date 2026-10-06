ALTER TABLE compliance_settings ALTER COLUMN signature_role_line SET DEFAULT 'PM Systems & Automation Specialist';
ALTER TABLE compliance_settings ALTER COLUMN physical_address SET DEFAULT '17, Radhaswami Nagar, Jaipur 302020, IN';
UPDATE compliance_settings SET signature_name='Sambhav Jain', signature_role_line='PM Systems & Automation Specialist', physical_address='17, Radhaswami Nagar, Jaipur 302020, IN', updated_at=now() WHERE id=1;
