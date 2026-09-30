-- 1. Store which custom fields are enabled per branch
ALTER TABLE estimate_settings 
  ADD COLUMN custom_fields_config TEXT NULL;

-- 2. Store filled-in custom field values per estimate
ALTER TABLE estimates 
  ADD COLUMN custom_fields_data TEXT NULL;
