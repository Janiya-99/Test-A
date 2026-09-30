-- Migration: Add target_stock (par level) to item
-- Date: 2026-09-22
-- Description: Adds an item-level target stock (par level) used to calculate
-- suggested restock quantities on the Restocking Report.
ALTER TABLE item
ADD COLUMN target_stock DECIMAL(10,2) NOT NULL DEFAULT 0;
