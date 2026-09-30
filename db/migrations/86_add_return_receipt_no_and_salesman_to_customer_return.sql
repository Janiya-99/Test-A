-- Migration: Add Return_Receipt_No and Employee_idEmployee (Sales Ref) to customer_return
-- Created: 2026-06-18

ALTER TABLE customer_return
ADD COLUMN Return_Receipt_No VARCHAR(255) NULL AFTER Invoice_idInvoice,
ADD COLUMN Employee_idEmployee INT NULL AFTER Return_Receipt_No;

-- Add index for performance
CREATE INDEX idx_customer_return_salesman ON customer_return(Employee_idEmployee);
