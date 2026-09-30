-- Migration: 130_create_loyalty_redemption_otps.sql
-- Purpose: Table for customer loyalty point redemption OTP verification and authorization tokens

CREATE TABLE IF NOT EXISTS `loyalty_redemption_otps` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NOT NULL,
  `branch_id` INT NOT NULL,
  `company_id` INT NULL,
  `channel` VARCHAR(10) NOT NULL DEFAULT 'SMS', -- 'SMS' or 'EMAIL'
  `recipient` VARCHAR(191) NOT NULL, -- Destination phone number or email address
  `otp_code` VARCHAR(10) NOT NULL, -- 6-digit OTP code
  `points_to_redeem` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'VERIFIED', 'USED', 'EXPIRED'
  `redemption_token` VARCHAR(64) NOT NULL UNIQUE, -- Secure authorization token returned upon verification
  `expires_at` DATETIME NOT NULL,
  `verified_at` DATETIME NULL,
  `used_at` DATETIME NULL,
  `invoice_id` INT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_loyalty_otp_token` (`redemption_token`),
  KEY `idx_loyalty_otp_cust_status` (`customer_id`, `status`),
  KEY `idx_loyalty_otp_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
