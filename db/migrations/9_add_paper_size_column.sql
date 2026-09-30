-- Migration: Add paper_size column to invoice_main_settings table
-- Date: 2026-01-01
-- Description: Adds support for storing invoice paper size configuration as JSON
ALTER TABLE invoice_main_settings
ADD COLUMN paper_size TEXT NULL COMMENT 'Stores paper size configuration as JSON: {type: string, width: number, height: number}';