-- Migration: Add manual_cost to service_job_items
ALTER TABLE `service_job_items` ADD COLUMN `manual_cost` double DEFAULT 0 AFTER `unit_price`;
