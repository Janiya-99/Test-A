ALTER TABLE invoice_has_item
ADD COLUMN Variation_Id INT NULL;

ALTER TABLE invoice_has_item
ADD CONSTRAINT fk_invoice_has_item FOREIGN KEY (Variation_Id) REFERENCES item_variations(id) ON DELETE
SET NULL ON UPDATE CASCADE;