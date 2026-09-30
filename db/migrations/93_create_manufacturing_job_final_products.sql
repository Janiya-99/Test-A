CREATE TABLE IF NOT EXISTS manufacturing_job_final_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NOT NULL,
    item_id INT NOT NULL,
    variation_id INT DEFAULT NULL,
    qty DECIMAL(15, 2) NOT NULL,
    profit_margin DECIMAL(15, 4) DEFAULT 0,
    selling_price DECIMAL(15, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES manufacturing_jobs(id) ON DELETE CASCADE
);

INSERT INTO manufacturing_job_final_products (job_id, item_id, variation_id, qty, profit_margin, selling_price)
SELECT id, final_product_id, final_product_variation_id, final_product_qty, profit_margin, selling_price FROM manufacturing_jobs;
