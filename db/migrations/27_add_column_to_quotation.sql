ALTER TABLE `quotation_header_settings`
ADD COLUMN `quotation_heading` varchar(255) DEFAULT 'QUOTATION'
AFTER `additional_note`