-- Migration 52: Track settlement discounts in supplier_log
ALTER TABLE supplier_log
  ADD COLUMN Discount_Amount DECIMAL(15,2) NULL AFTER Branch_idBranch;
