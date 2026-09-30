ALTER TABLE manufacturing_job_final_products
ADD COLUMN cost_percentage decimal(15,2) DEFAULT 100.00 AFTER qty,
ADD COLUMN unit_cost decimal(15,2) DEFAULT 0.00 AFTER cost_percentage;
