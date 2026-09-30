-- Migration: Add signature_url column to invoice_main_settings table
ALTER TABLE invoice_main_settings
ADD COLUMN signature_url VARCHAR(255) DEFAULT NULL;
