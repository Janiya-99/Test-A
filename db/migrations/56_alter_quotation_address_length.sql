-- Migration: Increase Address column size in quotation table to support branch JSON details
ALTER TABLE quotation MODIFY COLUMN Address VARCHAR(1000);
