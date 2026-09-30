-- Migration 137: Add Installment_Invoices privilege to user_privilages and userdesignation tables
ALTER TABLE `user_privilages`
  ADD COLUMN `Installment_Invoices` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Invoices`;

ALTER TABLE `userdesignation`
  ADD COLUMN `Installment_Invoices` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Invoices`;
