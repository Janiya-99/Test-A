-- Migration 51: Add Happy Hour and Store-Wide Promotion Rule Columns
ALTER TABLE promotion_rules
ADD COLUMN start_date DATE NULL,
ADD COLUMN end_date DATE NULL,
ADD COLUMN start_time TIME NULL,
ADD COLUMN end_time TIME NULL,
ADD COLUMN days_of_week VARCHAR(50) NULL,
ADD COLUMN is_whole_store TINYINT DEFAULT 0;
