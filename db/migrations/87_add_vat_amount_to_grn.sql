-- Migration: Add Vat_Amount column to grn table
ALTER TABLE `grn` ADD COLUMN `Vat_Amount` double DEFAULT 0 AFTER `Net_Total`;
