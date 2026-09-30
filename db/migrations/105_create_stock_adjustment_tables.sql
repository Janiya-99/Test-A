-- Migration 105: Create stock_adjustment and stock_adjustment_items tables for bulk stock adjustments

CREATE TABLE IF NOT EXISTS stock_adjustment (
  idStock_Adjustment INT AUTO_INCREMENT PRIMARY KEY,
  Adjustment_Number VARCHAR(255) NOT NULL,
  Date DATETIME NOT NULL,
  Notes TEXT,
  User_idUser INT NOT NULL,
  Branch_idBranch INT NOT NULL,
  Created_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  idStock_Adjustment_Item INT AUTO_INCREMENT PRIMARY KEY,
  Stock_Adjustment_idStock_Adjustment INT NOT NULL,
  Product_idItem INT NOT NULL,
  Old_Qty DECIMAL(15,2) NOT NULL,
  Adjustment_Qty DECIMAL(15,2) NOT NULL,
  New_Qty DECIMAL(15,2) NOT NULL,
  FOREIGN KEY (Stock_Adjustment_idStock_Adjustment) REFERENCES stock_adjustment(idStock_Adjustment) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
