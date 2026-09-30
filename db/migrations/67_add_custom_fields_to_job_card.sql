ALTER TABLE service_job_settings ADD COLUMN custom_fields_config LONGTEXT DEFAULT NULL;
ALTER TABLE service_jobs ADD COLUMN custom_fields_data LONGTEXT DEFAULT NULL;