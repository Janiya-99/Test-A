-- Migration: Add Business Items columns to service_job_items
ALTER TABLE service_job_items
ADD COLUMN qty DECIMAL(10,2) NULL DEFAULT 1.00,
ADD COLUMN unit_price DECIMAL(10,2) NULL DEFAULT 0.00,
ADD COLUMN total_amount DECIMAL(10,2) NULL DEFAULT 0.00,
ADD COLUMN is_business_item TINYINT(4) NULL DEFAULT 0;
