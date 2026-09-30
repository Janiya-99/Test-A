-- Migration: Add tax_template column and is_tax columns for header/footer settings
-- Date: 2026-07-08
-- Description: Adds support for separately configuring standard vs tax templates and their content details
ALTER TABLE invoice_main_settings
ADD COLUMN tax_template VARCHAR(255) DEFAULT 'Tax';
ALTER TABLE invoice_header_settings
ADD COLUMN is_tax INT DEFAULT 0;
ALTER TABLE invoice_footer_settings
ADD COLUMN is_tax INT DEFAULT 0;