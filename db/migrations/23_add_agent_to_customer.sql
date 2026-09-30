-- Add Agent_idEmployee to customer table
ALTER TABLE `customer` ADD COLUMN `Agent_idEmployee` INT NULL AFTER `Branch_idBranch`;

-- Add foreign key constraint (optional but recommended)
-- ALTER TABLE `customer` ADD CONSTRAINT `fk_customer_agent` FOREIGN KEY (`Agent_idEmployee`) REFERENCES `employee` (`idEmployee`) ON DELETE SET NULL ON UPDATE CASCADE;
