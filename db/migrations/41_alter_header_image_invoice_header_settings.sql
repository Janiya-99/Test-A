-- Migration: Alter header_image column in invoice_header_settings to LONGTEXT
-- To handle larger base64 images without "Data too long" error

ALTER TABLE `invoice_header_settings`
MODIFY COLUMN `header_image` LONGTEXT DEFAULT NULL;

-- Also alter footer_image in invoice_footer_settings to LONGTEXT for consistency
ALTER TABLE `invoice_footer_settings`
MODIFY COLUMN `footer_image` LONGTEXT DEFAULT NULL;

