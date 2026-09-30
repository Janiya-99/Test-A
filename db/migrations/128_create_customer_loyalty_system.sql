-- Migration: 128_create_customer_loyalty_system.sql
-- Purpose: Customer Loyalty Points System for SaaS tenants (settings, customer points, and transaction ledger)

-- 1. Add enable_loyalty flag to rules table if not already present
ALTER TABLE rules ADD COLUMN enable_loyalty TINYINT(1) DEFAULT 0 NULL;

-- 2. Create loyalty_settings table for branch/company customization
CREATE TABLE IF NOT EXISTS `loyalty_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `branch_id` INT NOT NULL,
  `company_id` INT NULL,
  `earn_point_type` VARCHAR(20) NOT NULL DEFAULT 'spend_ratio', -- 'spend_ratio', 'fixed_per_bill', 'percentage'
  `spend_amount_per_point` DECIMAL(12,2) NOT NULL DEFAULT 100.00,
  `points_per_spend` DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  `fixed_points_per_bill` DECIMAL(12,2) NOT NULL DEFAULT 10.00,
  `min_bill_amount_to_earn` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `max_points_per_bill` DECIMAL(12,2) NOT NULL DEFAULT 0.00, -- 0 means unlimited
  `redemption_point_value` DECIMAL(12,4) NOT NULL DEFAULT 1.0000, -- 1 point = 1.00 currency unit
  `min_points_to_redeem` DECIMAL(12,2) NOT NULL DEFAULT 50.00,
  `max_redemption_percentage` DECIMAL(5,2) NOT NULL DEFAULT 50.00, -- max % of bill payable with points
  `max_points_per_redemption` DECIMAL(12,2) NOT NULL DEFAULT 0.00, -- 0 means unlimited
  `points_expiry_days` INT NOT NULL DEFAULT 365, -- 0 means no expiry
  `enable_tier_system` TINYINT(1) NOT NULL DEFAULT 1,
  `tier_bronze_min_points` INT NOT NULL DEFAULT 0,
  `tier_silver_min_points` INT NOT NULL DEFAULT 500,
  `tier_gold_min_points` INT NOT NULL DEFAULT 2000,
  `tier_platinum_min_points` INT NOT NULL DEFAULT 5000,
  `tier_silver_multiplier` DECIMAL(5,2) NOT NULL DEFAULT 1.10,
  `tier_gold_multiplier` DECIMAL(5,2) NOT NULL DEFAULT 1.25,
  `tier_platinum_multiplier` DECIMAL(5,2) NOT NULL DEFAULT 1.50,
  `terms_and_conditions` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_branch_loyalty` (`branch_id`),
  KEY `idx_company_loyalty` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create customer_loyalty table to track customer points balance and tiers
CREATE TABLE IF NOT EXISTS `customer_loyalty` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NOT NULL UNIQUE,
  `company_id` INT NULL,
  `branch_id` INT NULL,
  `current_points` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `lifetime_points_earned` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `lifetime_points_redeemed` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `current_tier` VARCHAR(30) NOT NULL DEFAULT 'Bronze',
  `last_activity_date` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_cust_loyalty_customer` (`customer_id`),
  KEY `idx_cust_loyalty_branch` (`branch_id`),
  KEY `idx_cust_loyalty_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create customer_loyalty_logs table for point transactions ledger
CREATE TABLE IF NOT EXISTS `customer_loyalty_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NOT NULL,
  `branch_id` INT NULL,
  `company_id` INT NULL,
  `invoice_id` INT NULL,
  `transaction_type` VARCHAR(30) NOT NULL, -- 'EARNED', 'REDEEMED', 'MANUAL_ADD', 'MANUAL_DEDUCT', 'EXPIRED', 'REFUND_REVERSAL'
  `points` DECIMAL(12,2) NOT NULL,
  `points_balance_after` DECIMAL(12,2) NOT NULL,
  `bill_amount` DECIMAL(12,2) DEFAULT 0.00,
  `reference_note` VARCHAR(255) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_cust_logs_customer` (`customer_id`),
  KEY `idx_cust_logs_branch` (`branch_id`),
  KEY `idx_cust_logs_company` (`company_id`),
  KEY `idx_cust_logs_invoice` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
