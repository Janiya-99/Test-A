-- Migration: Add thermal_footer_image column to invoice_header_settings and quotation_header_settings
ALTER TABLE `invoice_header_settings` ADD COLUMN `thermal_footer_image` LONGTEXT DEFAULT NULL;
ALTER TABLE `quotation_header_settings` ADD COLUMN `thermal_footer_image` LONGTEXT DEFAULT NULL;
