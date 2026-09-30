CREATE TABLE IF NOT EXISTS `cashier_start` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `branch_id` INT NOT NULL,
    `opening_balance` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `opening_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `closing_time` DATETIME NULL,
    `closing_balance` DECIMAL(10, 2) NULL,
    `status` ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    `denominations` LONGTEXT NULL COMMENT 'JSON string of denominations',
    `notes` TEXT NULL,
    PRIMARY KEY (`id`)
);