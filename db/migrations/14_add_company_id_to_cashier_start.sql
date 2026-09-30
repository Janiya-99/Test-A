ALTER TABLE `cashier_start`
ADD COLUMN `company_id` INT NOT NULL DEFAULT 0
AFTER `branch_id`;