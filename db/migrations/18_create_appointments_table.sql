-- Create appointments table for managing customer, supplier, and other appointments
-- This table supports the appointment management feature in the invoicing system
CREATE TABLE IF NOT EXISTS `appointments` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `title` VARCHAR(255) NOT NULL COMMENT 'Appointment title/subject',
    `start_datetime` DATETIME NOT NULL COMMENT 'Start date and time of appointment',
    `end_datetime` DATETIME NOT NULL COMMENT 'End date and time of appointment',
    `location` VARCHAR(255) DEFAULT NULL COMMENT 'Physical or virtual location',
    `description` TEXT DEFAULT NULL COMMENT 'Additional notes and details',
    `participant_type` ENUM('customer', 'supplier', 'other') NOT NULL DEFAULT 'other' COMMENT 'Type of participant',
    `participant_id` INT DEFAULT NULL COMMENT 'Foreign key to customer or supplier ID',
    `participant_name` VARCHAR(255) DEFAULT NULL COMMENT 'Name for "other" type participants',
    `branch_id` INT NOT NULL COMMENT 'Branch ID for multi-branch support',
    `user_id` INT NOT NULL COMMENT 'User who created the appointment',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_branch_id` (`branch_id`),
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_participant_type_id` (`participant_type`, `participant_id`),
    INDEX `idx_start_datetime` (`start_datetime`),
    INDEX `idx_end_datetime` (`end_datetime`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Appointments for customers, suppliers, and others';