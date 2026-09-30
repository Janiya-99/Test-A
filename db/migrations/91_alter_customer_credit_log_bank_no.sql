-- Alter Bank_No column to VARCHAR(255) to support alphanumeric bank account numbers of any length
ALTER TABLE `customer_credit_log` MODIFY `Bank_No` VARCHAR(255) DEFAULT NULL;
