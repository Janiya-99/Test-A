-- Add Remarks column to invoice_has_item table
ALTER TABLE invoice_has_item
ADD COLUMN Remarks VARCHAR(500) NULL;
ALTER TABLE invoice
ADD COLUMN user VARCHAR(255) NULL;