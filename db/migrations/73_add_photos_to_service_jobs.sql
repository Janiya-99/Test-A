-- Migration: Add Photos to Service Jobs
CREATE TABLE IF NOT EXISTS `service_job_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `service_job_id` int(11) NOT NULL,
  `photo_path` varchar(512) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `service_job_id` (`service_job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `service_job_settings`
  ADD COLUMN `enable_photos` tinyint(4) DEFAULT 0,
  ADD COLUMN `max_photos` int(11) DEFAULT 5;
