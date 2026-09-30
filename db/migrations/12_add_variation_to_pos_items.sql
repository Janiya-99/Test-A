-- Migration: Add Variation_Id to pos_items table
-- Purpose: Store variation information for POS items so variation names appear in receipts
-- Date: 2026-01-14
-- Add Variation_Id column to pos_items table
ALTER TABLE pos_items
ADD COLUMN Variation_Id INT NULL COMMENT 'Foreign key to item_variations table - stores which product variation was sold in POS';
-- Add foreign key constraint for data integrity
ALTER TABLE pos_items
ADD CONSTRAINT fk_pos_items_variation FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;