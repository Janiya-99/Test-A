-- Migration: Add Return_Type and Variation support to customer returns
-- Created: 2026-01-02
-- Purpose: Enable customer returns to handle product variations and distinguish between returns vs damaged items
-- Add Return_Type column to customer_return table
ALTER TABLE customer_return
ADD COLUMN Return_Type ENUM('return', 'damage') NOT NULL DEFAULT 'return' COMMENT 'Type of return: return (add to stock) or damage (write-off)'
AFTER Reason;
-- Add Variation_Id column to customer_return_has_item table
ALTER TABLE customer_return_has_item
ADD COLUMN Variation_Id INT NULL COMMENT 'Foreign key to item_variations table - stores which product variation was returned'
AFTER Branch_idBranch;
-- Add index for better query performance
CREATE INDEX idx_customer_return_variation ON customer_return_has_item(Variation_Id);
-- Add foreign key constraint for data integrity (optional - remove if item_variations table doesn't exist)
ALTER TABLE customer_return_has_item
ADD CONSTRAINT fk_customer_return_item_variation FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;