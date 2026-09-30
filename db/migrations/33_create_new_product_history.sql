CREATE TABLE IF NOT EXISTS product_history_log (
    idProduct_History_Log INT AUTO_INCREMENT PRIMARY KEY,
    Product_idProduct INT NOT NULL,
    Variation_idVariation INT DEFAULT NULL,
    Date_Time DATETIME DEFAULT CURRENT_TIMESTAMP,
    Type VARCHAR(100) NOT NULL,
    Description TEXT,
    Quantity_Change DECIMAL(15, 2) NOT NULL,
    Old_Quantity DECIMAL(15, 2) NOT NULL,
    New_Quantity DECIMAL(15, 2) NOT NULL,
    User_idUser INT DEFAULT NULL,
    Branch_idBranch INT NOT NULL,
    Company_idCompany INT NOT NULL,
    Reference_ID INT DEFAULT NULL,
    INDEX (Product_idProduct),
    INDEX (Branch_idBranch),
    INDEX (Company_idCompany)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;