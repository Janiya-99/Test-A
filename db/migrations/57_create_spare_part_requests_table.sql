-- =====================================================================
-- Migration 57: Spare Part Request and Approval Workflow
-- Created: 2026-05-25
-- =====================================================================

-- 1. Create spare_part_requests table
CREATE TABLE IF NOT EXISTS `spare_part_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `request_no` VARCHAR(50) NOT NULL,
  `service_job_id` INT NOT NULL COMMENT 'FK to service_jobs.id',
  `item_id` INT NOT NULL COMMENT 'FK to item.idItem',
  `variation_id` INT NULL COMMENT 'FK to item_variations.id',
  `requested_qty` DECIMAL(15, 4) NOT NULL DEFAULT 1.0000,
  `issued_qty` DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
  `returned_qty` DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
  `status` ENUM(
    'pending_supervisor',
    'pending_store',
    'approved_issued',
    'rejected',
    'returned'
  ) NOT NULL DEFAULT 'pending_store',
  `rejection_reason` TEXT NULL,
  `technician_user_id` INT NOT NULL COMMENT 'FK to asipiya_user',
  `technician_employee_id` INT NULL COMMENT 'FK to employee',
  `supervisor_approved_by` INT NULL,
  `supervisor_approved_at` TIMESTAMP NULL,
  `store_approved_by` INT NULL,
  `store_approved_at` TIMESTAMP NULL,
  `min_id` INT NULL COMMENT 'FK to material_issue_notes.id',
  `branch_id` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_spr_job (service_job_id),
  INDEX idx_spr_item (item_id),
  INDEX idx_spr_status (status),
  INDEX idx_spr_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Alter material_issue_notes to link back to service jobs and requests
ALTER TABLE `material_issue_notes`
ADD COLUMN `service_job_id` INT NULL COMMENT 'FK to service_jobs.id',
ADD COLUMN `spare_part_request_id` INT NULL COMMENT 'FK to spare_part_requests.id';
