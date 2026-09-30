CREATE TABLE IF NOT EXISTS promotion_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    trigger_product_id INT NOT NULL,
    min_qty INT NOT NULL DEFAULT 1,
    reward_product_id INT NOT NULL,
    reward_qty INT NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    Branch_idBranch INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trigger_product_id) REFERENCES item(idItem) ON DELETE CASCADE,
    FOREIGN KEY (reward_product_id) REFERENCES item(idItem) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
ALTER TABLE invoice_has_item
ADD COLUMN is_bonus_line TINYINT(1) DEFAULT 0;
ALTER TABLE invoice_has_item
ADD COLUMN promo_rule_id INT DEFAULT NULL