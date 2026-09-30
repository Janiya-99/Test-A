CREATE TABLE IF NOT EXISTS grn_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  supplier_id INT NOT NULL,
  show_bank_account TINYINT(1) DEFAULT 0,
  bank_account_details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_branch_supplier (branch_id, supplier_id)
);
