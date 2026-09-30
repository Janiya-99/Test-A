ALTER TABLE manufacturing_jobs
ADD COLUMN IF NOT EXISTS final_product_variation_id INT DEFAULT NULL
AFTER final_product_id;
ALTER TABLE manufacturing_job_items
ADD COLUMN IF NOT EXISTS variation_id INT DEFAULT NULL
AFTER item_id;