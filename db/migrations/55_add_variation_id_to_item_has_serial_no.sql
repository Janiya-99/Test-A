-- Migration 55: Add Variation_Id to item_has_serial_no
-- Purpose: Track variation IDs for item serial numbers
-- Date: 2026-05-21

-- Add Variation_Id column to item_has_serial_no table
ALTER TABLE item_has_serial_no
ADD COLUMN Variation_Id INT NULL COMMENT 'Foreign key to item_variations table - tracks the product variation for the serial number';

-- Add foreign key constraint for data integrity
ALTER TABLE item_has_serial_no
ADD CONSTRAINT fk_item_has_serial_no_variation FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE SET NULL ON UPDATE CASCADE;
