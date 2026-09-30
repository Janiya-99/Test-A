-- Migration: Create Loyalty & XP Marketing System Tables
-- Created: 2026-05-26
-- Purpose: Support modern gamified Loyalty & XP system with tiers, XP logging, and plan-based locking.

-- Create table for subscription status
CREATE TABLE IF NOT EXISTS `subscription_status` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `plan_name` VARCHAR(50) NOT NULL DEFAULT 'Free Plan', -- 'Free Plan', 'Standard Plan', 'Professional Plan'
    `status` VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'expired', etc.
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_user_subscription` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table for user XP status
CREATE TABLE IF NOT EXISTS `user_loyalty` (
    `user_id` INT PRIMARY KEY,
    `current_xp` INT NOT NULL DEFAULT 0,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table for detailed XP logs
CREATE TABLE IF NOT EXISTS `xp_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `trigger_type` VARCHAR(50) NOT NULL, -- 'daily_login', 'invoice_creation', 'grn_creation', 'appointment_creation'
    `xp_awarded` INT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_xp_logs_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
