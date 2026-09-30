CREATE TABLE IF NOT EXISTS `appointment_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `default_location` varchar(255) DEFAULT NULL,
  `default_start_time` varchar(10) DEFAULT NULL,
  `default_end_time` varchar(10) DEFAULT NULL,
  `public_booking_token` varchar(64) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `branch_id` (`branch_id`),
  UNIQUE KEY `public_booking_token` (`public_booking_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
