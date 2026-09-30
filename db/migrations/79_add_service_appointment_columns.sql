ALTER TABLE `appointments` 
  ADD COLUMN `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `recurrence_pattern` varchar(50) DEFAULT NULL,
  ADD COLUMN `recurrence_interval` int NOT NULL DEFAULT 1,
  ADD COLUMN `recurrence_end_date` date DEFAULT NULL,
  ADD COLUMN `is_service_followup` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `invoice_id` int DEFAULT NULL,
  ADD COLUMN `service_job_id` int DEFAULT NULL,
  ADD COLUMN `service_due_date` date DEFAULT NULL;
