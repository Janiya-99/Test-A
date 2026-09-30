-- Migration: Link customer returns to invoices
-- Created: 2026-02-27
-- Purpose: Associate customer returns with specific invoices to enable invoice-based returns
-- Add Invoice_idInvoice column to customer_return table
ALTER TABLE customer_return
ADD COLUMN Invoice_idInvoice INT NULL
AFTER Customer_idCustomer;
-- Add Invoice_Item_Id to customer_return_has_item to reference the original invoice item
ALTER TABLE customer_return_has_item
ADD COLUMN Invoice_Item_Id INT NULL
AFTER Variation_Id;
-- Add index for performance
CREATE INDEX idx_customer_return_invoice ON customer_return(Invoice_idInvoice);