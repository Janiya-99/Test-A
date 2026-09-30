-- Migration: 129_create_gift_voucher_system.sql
-- Purpose: SaaS Customizable Gift Voucher System (settings, vouchers, barcode, single-use full redemption, and audit ledger)

-- 1. Add enable_gift_voucher flag to rules table
ALTER TABLE `rules` ADD COLUMN `enable_gift_voucher` TINYINT(1) DEFAULT 0 NULL;

-- 2. Create gift_voucher_settings table
CREATE TABLE IF NOT EXISTS `gift_voucher_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `branch_id` INT NOT NULL UNIQUE,
  `company_id` INT NULL,
  `voucher_prefix` VARCHAR(20) NOT NULL DEFAULT 'GV-',
  `code_length` INT NOT NULL DEFAULT 8,
  `default_expiry_days` INT NOT NULL DEFAULT 180, -- 0 means no expiry
  `allow_with_promotions` TINYINT(1) NOT NULL DEFAULT 1,
  `min_spend_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `terms_and_conditions` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_gv_settings_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create gift_vouchers table
CREATE TABLE IF NOT EXISTS `gift_vouchers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `voucher_code` VARCHAR(50) NOT NULL UNIQUE,
  `barcode` VARCHAR(50) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `customer_id` INT NULL,
  `recipient_name` VARCHAR(150) NULL,
  `recipient_phone` VARCHAR(30) NULL,
  `recipient_email` VARCHAR(150) NULL,
  `branch_id` INT NOT NULL,
  `company_id` INT NULL,
  `expiry_date` DATE NULL, -- NULL means no expiry
  `status` ENUM('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOIDED') NOT NULL DEFAULT 'ACTIVE',
  `issue_type` ENUM('DIRECT_ISSUED', 'INVOICED', 'PROMOTIONAL', 'BATCH') NOT NULL DEFAULT 'DIRECT_ISSUED',
  `created_invoice_id` INT NULL,
  `redeemed_invoice_id` INT NULL,
  `redeemed_at` DATETIME NULL,
  `notes` VARCHAR(255) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_gv_code` (`voucher_code`),
  KEY `idx_gv_barcode` (`barcode`),
  KEY `idx_gv_branch` (`branch_id`),
  KEY `idx_gv_company` (`company_id`),
  KEY `idx_gv_customer` (`customer_id`),
  KEY `idx_gv_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create gift_voucher_logs table
CREATE TABLE IF NOT EXISTS `gift_voucher_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `voucher_id` INT NOT NULL,
  `branch_id` INT NOT NULL,
  `company_id` INT NULL,
  `action` ENUM('ISSUED', 'REDEEMED', 'VOIDED', 'REFUNDED', 'EXPIRED') NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `invoice_id` INT NULL,
  `customer_id` INT NULL,
  `reference_note` VARCHAR(255) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_gv_log_voucher` (`voucher_id`),
  KEY `idx_gv_log_invoice` (`invoice_id`),
  KEY `idx_gv_log_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
