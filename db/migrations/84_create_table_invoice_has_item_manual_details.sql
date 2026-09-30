CREATE TABLE IF NOT EXISTS invoice_has_item_manual_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_has_item_id INT NOT NULL,
  supplier_name VARCHAR(255) NULL,
  cost DECIMAL(15,2) NULL,
  FOREIGN KEY (invoice_has_item_id) REFERENCES invoice_has_item(ID) ON DELETE CASCADE
);
