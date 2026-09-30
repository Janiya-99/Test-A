-- Migration: Add completion_reason to service_jobs table
ALTER TABLE service_jobs
ADD COLUMN completion_reason TEXT DEFAULT NULL;
