-- Migration 102: Add update_product_cost to grn table
ALTER TABLE grn ADD COLUMN update_product_cost TINYINT(1) DEFAULT 1;
