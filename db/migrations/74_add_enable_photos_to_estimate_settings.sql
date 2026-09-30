-- Migration: Add enable_photos to estimate_settings
ALTER TABLE `estimate_settings`
  ADD COLUMN `enable_photos` tinyint(4) DEFAULT 1;
