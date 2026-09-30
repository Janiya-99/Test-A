-- Migration 133: Add indexes for POS enhancements (batch warehouse lookup, customer salesperson lookup, invoice date)
-- Date: 2026-09-23
ALTER TABLE item_batch ADD INDEX IF NOT EXISTS idx_batch_warehouse_item (warehouse_id, item_id, qty);
ALTER TABLE customer ADD INDEX IF NOT EXISTS idx_customer_branch_agent (Branch_idBranch, Agent_idEmployee, Status);
ALTER TABLE invoice ADD INDEX IF NOT EXISTS idx_invoice_date_branch (Date, Branch_idBranch);
