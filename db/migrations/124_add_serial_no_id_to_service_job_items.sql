-- Migration: Add serial_no_id to service_job_items
ALTER TABLE `service_job_items` ADD COLUMN `serial_no_id` INT NULL DEFAULT NULL;
