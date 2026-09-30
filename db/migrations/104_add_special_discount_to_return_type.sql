-- Modify Return_Type column in customer_return table to include special_discount
ALTER TABLE customer_return MODIFY COLUMN Return_Type ENUM('return', 'damage', 'special_discount') NOT NULL DEFAULT 'return';

-- Modify Item_Return_Type column in customer_return_has_item table to include special_discount
ALTER TABLE customer_return_has_item MODIFY COLUMN Item_Return_Type ENUM('return', 'damage', 'special_discount') NOT NULL DEFAULT 'return';
