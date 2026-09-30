CREATE TABLE IF NOT EXISTS `cash_history` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `cashier_start_id` INT NOT NULL,
    `type` ENUM('in', 'out') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `reason` TEXT NULL,
    `time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
);
CREATE TABLE IF NOT EXISTS cash_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cashier_start_id INT NOT NULL,
    type ENUM('in', 'out') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    reason TEXT,
    time DATETIME NOT NULL
);