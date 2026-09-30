-- =====================================================================
-- Migration 53: Project Material Issue & Billing Module
-- Created: 2026-05-19
-- =====================================================================
-- 1. Material Issue Note header table
CREATE TABLE IF NOT EXISTS material_issue_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_number VARCHAR(50) NOT NULL,
  issue_date DATE NOT NULL,
  project_id INT NULL COMMENT 'FK to pro.id — nullable for non-project issues',
  issued_for_type ENUM('project', 'general', 'internal') NOT NULL DEFAULT 'general',
  warehouse_id INT NOT NULL COMMENT 'FK to warehouses.id',
  delivery_location VARCHAR(255) NULL,
  assigned_person_name VARCHAR(150) NULL,
  assigned_user_id INT NULL COMMENT 'FK to asipiya_user (optional)',
  transport_note TEXT NULL,
  note TEXT NULL,
  total_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
  item_count INT NOT NULL DEFAULT 0,
  status ENUM(
    'draft',
    'issued',
    'partially_invoiced',
    'fully_invoiced'
  ) NOT NULL DEFAULT 'issued',
  branch_id INT NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_min_project_id (project_id),
  INDEX idx_min_branch_id (branch_id),
  INDEX idx_min_status (status),
  INDEX idx_min_issue_date (issue_date),
  INDEX idx_min_warehouse (warehouse_id)
);
-- 2. Material Issue Note line items
CREATE TABLE IF NOT EXISTS material_issue_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_note_id INT NOT NULL COMMENT 'FK to material_issue_notes.id',
  item_id INT NOT NULL COMMENT 'FK to item.idItem',
  batch_id INT NULL COMMENT 'FK to item_batch.batch_id — which batch was used',
  variation_id INT NULL COMMENT 'FK to item_variations (if applicable)',
  item_description VARCHAR(255) NOT NULL,
  item_code VARCHAR(100) NULL,
  qty_issued DECIMAL(15, 4) NOT NULL,
  qty_invoiced DECIMAL(15, 4) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(15, 4) NOT NULL DEFAULT 0 COMMENT 'Cost at time of issue',
  unit_rate DECIMAL(15, 4) NOT NULL DEFAULT 0 COMMENT 'Selling rate for invoice',
  total_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
  billing_status ENUM('pending', 'partial', 'invoiced') NOT NULL DEFAULT 'pending',
  branch_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mii_issue_note_id (issue_note_id),
  INDEX idx_mii_item_id (item_id),
  INDEX idx_mii_billing_status (billing_status)
);
-- 3. Invoice mapping — prevents double-billing, enables partial invoicing
CREATE TABLE IF NOT EXISTS material_issue_invoice_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_item_id INT NOT NULL COMMENT 'FK to material_issue_items.id',
  issue_note_id INT NOT NULL COMMENT 'FK to material_issue_notes.id',
  invoice_id INT NOT NULL COMMENT 'FK to invoice.idInvoice',
  qty_invoiced DECIMAL(15, 4) NOT NULL,
  project_id INT NULL,
  branch_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_miim_issue_item_id (issue_item_id),
  INDEX idx_miim_invoice_id (invoice_id),
  INDEX idx_miim_project_id (project_id)
);
-- 4. Extend pro table with customer linkage and project status
ALTER TABLE pro
ADD COLUMN customer_id INT NULL COMMENT 'FK to customer.idCustomer',
  ADD COLUMN project_status ENUM('active', 'completed', 'on_hold', 'cancelled') NOT NULL DEFAULT 'active';