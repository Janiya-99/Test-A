ALTER TABLE `estimates`
  ADD COLUMN `invoice_no` VARCHAR(100) DEFAULT NULL AFTER `parent_estimate_id`,
  ADD COLUMN `quotation_no` VARCHAR(100) DEFAULT NULL AFTER `invoice_no`;
