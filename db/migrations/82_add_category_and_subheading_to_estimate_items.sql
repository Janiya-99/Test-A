-- Migration: Add Category, Sub-heading, and Item Type to Estimate Items
ALTER TABLE `estimate_items` 
ADD COLUMN `category` VARCHAR(100) DEFAULT 'SERVICES',
ADD COLUMN `sub_heading` VARCHAR(255) DEFAULT '',
ADD COLUMN `item_type` VARCHAR(100) DEFAULT '';
