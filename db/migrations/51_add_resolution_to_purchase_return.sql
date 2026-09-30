-- Migration: Add resolution tracking to purchase_return table
-- Description: Adds columns to track if a purchase return has been resolved by a GRN.

ALTER TABLE purchase_return ADD COLUMN Resolved_GRN_Id INT DEFAULT NULL;
ALTER TABLE purchase_return ADD COLUMN Is_Resolved TINYINT DEFAULT 0;
