-- Migration: Add Invoice and Quotation tracking to Service Jobs
ALTER TABLE service_jobs
ADD COLUMN invoice_id INT DEFAULT NULL,
ADD COLUMN quotation_id INT DEFAULT NULL;
