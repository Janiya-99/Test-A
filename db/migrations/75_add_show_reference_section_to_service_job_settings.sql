-- Migration: Add show_reference_section to service_job_settings
ALTER TABLE `service_job_settings`
  ADD COLUMN `show_reference_section` tinyint(4) DEFAULT 1;
