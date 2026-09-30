-- =====================================================================
-- Migration 60: Add Spare Part Approval Pipeline Settings to service_job_settings
-- Created: 2026-06-01
-- =====================================================================

ALTER TABLE `service_job_settings`
ADD COLUMN `spare_part_approval_flow` VARCHAR(50) NOT NULL DEFAULT 'value_based',
ADD COLUMN `spare_part_high_value_threshold` DECIMAL(15, 4) NOT NULL DEFAULT 5000.0000,
ADD COLUMN `spare_part_high_value_keywords` TEXT NULL;
