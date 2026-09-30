ALTER TABLE rules ADD COLUMN stock_management_mode VARCHAR(50) DEFAULT 'ITEM_WISE';

CREATE TABLE IF NOT EXISTS item_has_supplier (
  id INT AUTO_INCREMENT PRIMARY KEY,
  Item_idItem INT NOT NULL,
  Supplier_idSupplier INT NOT NULL,
  Branch_idBranch INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (Item_idItem) REFERENCES item(idItem) ON DELETE CASCADE,
  FOREIGN KEY (Supplier_idSupplier) REFERENCES supplier(idSupplier) ON DELETE CASCADE,
  UNIQUE KEY unique_item_supplier (Item_idItem, Supplier_idSupplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
