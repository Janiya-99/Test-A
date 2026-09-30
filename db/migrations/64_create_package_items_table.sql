--
-- Table structure for table `package_items`
--

CREATE TABLE IF NOT EXISTS `package_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `package_id` INT NOT NULL,
    `item_id` INT NOT NULL,
    `variation_id` INT NULL,
    `qty` INT NOT NULL DEFAULT 1,
    `rate` DECIMAL(10,2) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_package_items_package` FOREIGN KEY (`package_id`) REFERENCES `item` (`idItem`) ON DELETE CASCADE,
    CONSTRAINT `fk_package_items_item` FOREIGN KEY (`item_id`) REFERENCES `item` (`idItem`) ON DELETE CASCADE,
    CONSTRAINT `fk_package_items_variation` FOREIGN KEY (`variation_id`) REFERENCES `item_variations` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
