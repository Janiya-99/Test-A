-- Migration 135: Add is_visible column and performance index to item table
-- Date: 2026-09-24
-- Description: Adds is_visible column (TINYINT(1) default 1) to item table to hide internal raw materials / recipe items from POS and Sales grids.

ALTER TABLE item ADD COLUMN IF NOT EXISTS is_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER Status;
ALTER TABLE item ADD INDEX IF NOT EXISTS idx_branch_status_visibility (Branch_idBranch, Status, is_visible);
