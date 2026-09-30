-- Migration: Add Variation_Id to quotation_has_item table
-- Created: 2026-01-02
-- Purpose: Enable quotations to store variation information for proper inventory reduction when converting to invoices
-- Add Variation_Id column to quotation_has_item table
ALTER TABLE quotation_has_item
ADD COLUMN Variation_Id INT NULL COMMENT 'Foreign key to item_variations table - stores which product variation was quoted'
AFTER Branch_idBranch;
-- Optional: Add index for better query performance
CREATE INDEX idx_quotation_variation ON quotation_has_item(Variation_Id);
-- Optional: Add foreign key constraint for data integrity
ALTER TABLE quotation_has_item
ADD CONSTRAINT fk_quotation_item_variation FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;