-- Create table for appointment notify people
CREATE TABLE IF NOT EXISTS `appointment_notify_people` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL COMMENT 'Name of the notify person',
    `whatsapp_number` VARCHAR(20) NOT NULL COMMENT 'WhatsApp number with country code',
    `branch_id` INT NOT NULL COMMENT 'Branch ID for multi-branch support',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_branch_id` (`branch_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Notify people for appointments';
