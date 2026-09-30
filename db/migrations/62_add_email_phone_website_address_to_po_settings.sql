-- Migration: Add show_email, show_phone, show_website, and show_address to po_settings
-- This allows toggling business contact details on the Purchase Order print template.

ALTER TABLE po_settings
  ADD COLUMN show_email TINYINT(1) DEFAULT 1 AFTER show_discount,
  ADD COLUMN show_phone TINYINT(1) DEFAULT 1 AFTER show_email,
  ADD COLUMN show_website TINYINT(1) DEFAULT 1 AFTER show_phone,
  ADD COLUMN show_address TINYINT(1) DEFAULT 1 AFTER show_website;
