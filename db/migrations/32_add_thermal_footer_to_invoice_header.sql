-- Migration: Add thermal_footer_message column to invoice_header_settings
-- Run this in phpMyAdmin or MySQL console against your asipiya_test database
ALTER TABLE `invoice_header_settings`
ADD COLUMN `thermal_footer_message` VARCHAR(255) DEFAULT 'හොදම දේ අඩුම මිලට';