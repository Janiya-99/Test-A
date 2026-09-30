--
-- Table for Product Variations
--

CREATE TABLE IF NOT EXISTS `item_variations` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `item_id` INT NOT NULL,
    `description` VARCHAR(255) NULL,
    `item_code` VARCHAR(45) NULL,
    `cost` DECIMAL(10, 2) NULL,
    `rate` DECIMAL(10, 2) NULL,
    `qty` DECIMAL(10, 2) NULL DEFAULT 0,
    `attributes` JSON NULL,
    `product_sku` VARCHAR(100) NULL,
    `product_plu` VARCHAR(100) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `fk_item_variations_item_idx` (`item_id` ASC),
    CONSTRAINT `fk_item_variations_item` FOREIGN KEY (`item_id`) REFERENCES `item` (`idItem`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `grn_item_variations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `grn_id` INT NOT NULL,
    `item_id` INT NOT NULL,
    `variation_id` INT NOT NULL,
    `qty` DECIMAL(10,2) NOT NULL,
    `cost` DECIMAL(10,2) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT `fk_grn_item_variations_grn`
        FOREIGN KEY (`grn_id`)
        REFERENCES `grn`(`idGRN`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_grn_item_variations_item`
        FOREIGN KEY (`item_id`)
        REFERENCES `item`(`idItem`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_grn_item_variations_variation`
        FOREIGN KEY (`variation_id`)
        REFERENCES `item_variations`(`id`)
        ON DELETE CASCADE,

    INDEX `idx_grn_id` (`grn_id`),
    INDEX `idx_item_id` (`item_id`),
    INDEX `idx_variation_id` (`variation_id`)
) ENGINE=InnoDB;