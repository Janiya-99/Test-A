-- Migration: Add custom fields support to invoices
ALTER TABLE invoice_header_settings ADD COLUMN custom_fields_config LONGTEXT DEFAULT NULL;
ALTER TABLE invoice ADD COLUMN custom_fields_data LONGTEXT DEFAULT NULL;
