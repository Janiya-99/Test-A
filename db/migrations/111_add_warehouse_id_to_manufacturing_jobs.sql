-- Migration 106: Add warehouse destination option for Manufacturing Job final products

ALTER TABLE item_batch MODIFY COLUMN grn_id INT NULL;
ALTER TABLE manufacturing_jobs ADD COLUMN warehouse_id INT DEFAULT NULL;
ALTER TABLE item_batch ADD COLUMN manufacturing_job_id INT DEFAULT NULL;
ALTER TABLE item_batch ADD CONSTRAINT fk_item_batch_manufacturing_job FOREIGN KEY (manufacturing_job_id) REFERENCES manufacturing_jobs(id) ON DELETE CASCADE;
