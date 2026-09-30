-- Migration: 134_add_vehicle_and_responsible_user_to_warehouses
-- Date: 2026-09-23
-- Description: Add warehouse_type/vehicle_number/responsible_user_id to support
--              mobile (vehicle/lorry) warehouses and a per-warehouse custodian.
--              No FK constraints added, consistent with existing table convention.

ALTER TABLE `warehouses`
  ADD COLUMN `warehouse_type` ENUM('store','vehicle') NOT NULL DEFAULT 'store' AFTER `warehouse_code`,
  ADD COLUMN `vehicle_number` VARCHAR(50) DEFAULT NULL AFTER `warehouse_type`,
  ADD COLUMN `responsible_user_id` INT DEFAULT NULL AFTER `vehicle_number`;

ALTER TABLE `warehouses`
  ADD INDEX `idx_warehouses_responsible_user_id` (`responsible_user_id`),
  ADD INDEX `idx_warehouses_warehouse_type` (`warehouse_type`);
