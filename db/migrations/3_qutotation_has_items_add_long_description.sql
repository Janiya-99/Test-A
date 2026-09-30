ALTER TABLE quotation_has_item
ADD COLUMN Long_Description VARCHAR(255) NULL,
ADD COLUMN Variation_Id INT NULL;

ALTER TABLE quotation_has_items
ADD CONSTRAINT fk_quotation_has_items FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;