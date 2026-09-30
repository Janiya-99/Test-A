-- Migration: Add Material Issue Tracking Columns to quotation_has_item
-- Created: 2026-05-25
-- Purpose: Enable quotation items to store material issue details so they don't cause double stock deduction when converted to invoices

ALTER TABLE quotation_has_item
ADD COLUMN is_material_issue TINYINT(1) DEFAULT 0 COMMENT 'Flag indicating if this item was issued via a material issue note',
ADD COLUMN issue_item_id INT NULL DEFAULT NULL COMMENT 'Reference to the specific material_issue_items.id',
ADD COLUMN issue_note_id INT NULL DEFAULT NULL COMMENT 'Reference to the parent material_issue_notes.id';

ALTER TABLE material_issue_items ADD COLUMN serial_no_id INT NULL DEFAULT NULL COMMENT 'FK to item_has_serial_no.ID' AFTER variation_id;

ALTER TABLE rules ADD COLUMN Explicit_Warehouse_Deduct TINYINT(1) NULL DEFAULT 0;