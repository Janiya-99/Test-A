CREATE TABLE IF NOT EXISTS quotation_has_item_manual_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_has_item_id INT NOT NULL,
  Branch_idBranch INT NOT NULL,
  supplier_name VARCHAR(255) NULL,
  cost DECIMAL(15,2) NULL,
  FOREIGN KEY (quotation_has_item_id, Branch_idBranch) REFERENCES quotation_has_item(Id, Branch_idBranch) ON DELETE CASCADE
);
