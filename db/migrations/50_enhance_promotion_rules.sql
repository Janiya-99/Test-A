-- Migration 50: Enhance promotion rules to support discount-based rewards
ALTER TABLE promotion_rules
ADD COLUMN promo_type ENUM('buy_x_get_y', 'buy_x_get_discount') DEFAULT 'buy_x_get_y',
ADD COLUMN discount_value DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN discount_type ENUM('percentage', 'amount') DEFAULT 'percentage',
MODIFY COLUMN reward_product_id INT NULL,
MODIFY COLUMN reward_qty INT NULL;
