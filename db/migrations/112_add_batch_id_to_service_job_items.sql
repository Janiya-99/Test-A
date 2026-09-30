-- Migration: Add batch_id to service_job_items
ALTER TABLE `service_job_items` ADD COLUMN `batch_id` INT NULL DEFAULT NULL, ADD COLUMN `variation_id` INT NULL DEFAULT NULL;
