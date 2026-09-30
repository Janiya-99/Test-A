-- Migration: Add parent_estimate_id to estimates
ALTER TABLE `estimates`
  ADD COLUMN `parent_estimate_id` int(11) DEFAULT NULL AFTER `user_id`,
  ADD CONSTRAINT `fk_parent_estimate` FOREIGN KEY (`parent_estimate_id`) REFERENCES `estimates` (`id`) ON DELETE SET NULL;
