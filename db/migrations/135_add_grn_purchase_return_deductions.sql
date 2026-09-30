-- Migration: 133_add_grn_purchase_return_deductions.sql
-- Description: Add Applied_Return_Amount to grn, Settlement_Type to purchase_return, and create grn_has_applied_return table.

ALTER TABLE `grn` ADD COLUMN `Applied_Return_Amount` DECIMAL(15,2) DEFAULT 0.00;

ALTER TABLE `purchase_return` ADD COLUMN `Settlement_Type` VARCHAR(50) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `grn_has_applied_return` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `GRN_idGRN` INT NOT NULL,
  `Purchase_Return_idPurchase_Return` INT NOT NULL,
  `Applied_Amount` DECIMAL(15,2) NOT NULL,
  `Created_At` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_grn_id` (`GRN_idGRN`),
  INDEX `idx_purchase_return_id` (`Purchase_Return_idPurchase_Return`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
