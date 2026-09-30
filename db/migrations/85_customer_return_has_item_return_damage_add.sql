ALTER TABLE customer_return_has_item 
ADD COLUMN Item_Return_Type ENUM('return', 'damage') NOT NULL DEFAULT 'return';