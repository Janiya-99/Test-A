-- =====================================================================
-- Migration 90: Add manual product support to material issue notes
-- Created: 2026-06-19
-- =====================================================================

ALTER TABLE material_issue_items
  MODIFY COLUMN item_id INT NULL COMMENT 'FK to item.idItem — nullable for manual products',
  ADD COLUMN is_manual_item TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN manual_supplier_name VARCHAR(255) NULL,
  ADD COLUMN manual_cost DECIMAL(15, 4) NULL;
