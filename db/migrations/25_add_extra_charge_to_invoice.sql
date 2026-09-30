ALTER TABLE rules
ADD COLUMN salesman_invoice_update TINYINT(1) DEFAULT 0;
-- ALTER TABLE invoice
-- ADD COLUMN Extra_Charge DECIMAL(10, 2) DEFAULT 0.00;
-- ALTER TABLE invoice
-- ADD COLUMN Extra_Charge_Label VARCHAR(255) DEFAULT 'Extra Charge';