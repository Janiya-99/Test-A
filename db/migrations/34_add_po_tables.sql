CREATE TABLE IF NOT EXISTS purchase_orders (
    idPurchase_Order INT AUTO_INCREMENT PRIMARY KEY,
    Date DATETIME,
    Supplier_idSupplier INT,
    PO_Number VARCHAR(255),
    Items_Count INT,
    Total_Amount DECIMAL(15, 2),
    Bill_Discount DECIMAL(15, 2),
    Bill_Discount_Type VARCHAR(50),
    Discount_Amount DECIMAL(15, 2),
    Net_Total DECIMAL(15, 2),
    Status INT DEFAULT 0,
    Branch_idBranch INT,
    Created_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
    idPurchase_Order_Items INT AUTO_INCREMENT PRIMARY KEY,
    Purchase_Order_idPurchase_Order INT,
    Item_idItem INT,
    Item_Description TEXT,
    Cost DECIMAL(15, 2),
    Qty_Type VARCHAR(50),
    Qty DECIMAL(15, 2),
    Total DECIMAL(15, 2),
    Discount DECIMAL(15, 2),
    Sub_Total DECIMAL(15, 2),
    Branch_idBranch INT,
    Variation_Id INT
);
ALTER TABLE grn
ADD COLUMN Purchase_Order_id INT NULL;
ALTER TABLE rules
ADD COLUMN PO_No_Start_With VARCHAR(255) DEFAULT 'PO-';
ALTER TABLE rules
ADD COLUMN PO_No_Start_From INT DEFAULT 1;
ALTER TABLE grn
ADD COLUMN Bill_Discount_Type VARCHAR(45) NULL;