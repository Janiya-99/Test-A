-- Add custom fields support to quotations
ALTER TABLE quotation_main_settings ADD COLUMN custom_fields_config LONGTEXT DEFAULT NULL;
ALTER TABLE quotation ADD COLUMN custom_fields_data LONGTEXT DEFAULT NULL;
