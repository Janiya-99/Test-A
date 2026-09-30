-- Migration: Add vat_no column to invoice_header_settings
-- Run this in phpMyAdmin or MySQL console against your asipiya_test database

ALTER TABLE `invoice_header_settings`
ADD COLUMN IF NOT EXISTS `vat_no` varchar(100) DEFAULT NULL AFTER `company_reg`;
