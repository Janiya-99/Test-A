ALTER TABLE item_batch
ADD COLUMN variation_id INT NULL,
ADD COLUMN expiry_date DATETIME NULL;

ALTER TABLE item_batch
ADD CONSTRAINT fk_item_batch FOREIGN KEY (variation_id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;