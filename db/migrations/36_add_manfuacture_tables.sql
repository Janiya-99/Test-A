CREATE TABLE IF NOT EXISTS manufacturing_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_number VARCHAR(45) NOT NULL,
    job_date DATE NOT NULL,
    final_product_id INT NOT NULL,
    final_product_qty DECIMAL(15, 2) NOT NULL,
    total_material_cost DECIMAL(15, 2) NOT NULL,
    note TEXT,
    branch_id INT NOT NULL,
    user_id INT NOT NULL,
    status TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS manufacturing_job_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    item_id INT NOT NULL,
    qty DECIMAL(15, 2) NOT NULL,
    cost DECIMAL(15, 2) NOT NULL,
    total_cost DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (job_id) REFERENCES manufacturing_jobs(id) ON DELETE CASCADE
);
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS Manufacture_No_Start_With VARCHAR(255) DEFAULT 'MFJ-';
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS Manufacture_No_Start_From INT DEFAULT 1;
ALTER TABLE rules
ADD COLUMN Manufacture_No_Start_With VARCHAR(255) DEFAULT 'MFJ-';
ALTER TABLE rules
ADD COLUMN Manufacture_No_Start_From INT DEFAULT 1;
ALTER TABLE purchase_orders
ADD COLUMN Additional_Note TEXT;
ALTER TABLE purchase_order_items
ADD COLUMN Additional_Note TEXT;
ALTER TABLE customer
ADD COLUMN overpayment DECIMAL(15, 2) DEFAULT 0.00;