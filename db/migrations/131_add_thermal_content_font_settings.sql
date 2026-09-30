-- Migration: Add thermal content font and paper width settings to invoice_main_settings
-- Date: 2026-09-21
-- Description: Adds configurable font size, font family, and paper width for thermal receipt item table/totals rendering
ALTER TABLE invoice_main_settings
ADD COLUMN thermal_font_size VARCHAR(10) DEFAULT 'medium';
ALTER TABLE invoice_main_settings
ADD COLUMN thermal_font_family VARCHAR(50) DEFAULT NULL;
ALTER TABLE invoice_main_settings
ADD COLUMN thermal_paper_width VARCHAR(10) DEFAULT '80mm';
