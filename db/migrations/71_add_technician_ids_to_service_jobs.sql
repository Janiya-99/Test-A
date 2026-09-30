-- Migration: Add technician_ids to service_jobs and item_technician_id to service_job_items
ALTER TABLE `service_jobs`
ADD COLUMN `technician_ids` LONGTEXT DEFAULT NULL;

ALTER TABLE `service_job_items`
ADD COLUMN `item_technician_id` INT(11) DEFAULT NULL;
