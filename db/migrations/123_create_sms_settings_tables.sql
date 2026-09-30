CREATE TABLE IF NOT EXISTS `sms_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `branch_id` INT NOT NULL,
  `event_key` VARCHAR(50) NOT NULL,
  `template_text` TEXT DEFAULT NULL,
  `is_enabled` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_branch_event` (`branch_id`, `event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
