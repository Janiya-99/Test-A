-- Migration script to add created_at column to invoice table
ALTER TABLE invoice ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Optional: Backfill existing records from the Created_Date (varchar) column
-- This assumes the format 'YYYY-MM-DD HH:mm'
UPDATE invoice 
SET created_at = STR_TO_DATE(Created_Date, '%Y-%m-%d %H:%i') 
WHERE Created_Date IS NOT NULL AND Created_Date != '';
