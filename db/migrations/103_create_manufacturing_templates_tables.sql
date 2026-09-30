CREATE TABLE IF NOT EXISTS manufacturing_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL,
    note TEXT,
    branch_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manufacturing_template_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    item_id INT NOT NULL,
    variation_id INT DEFAULT NULL,
    qty DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (template_id) REFERENCES manufacturing_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS manufacturing_template_final_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    item_id INT NOT NULL,
    variation_id INT DEFAULT NULL,
    qty DECIMAL(15, 2) NOT NULL,
    cost_percentage DECIMAL(15, 2) NOT NULL,
    profit_margin DECIMAL(15, 4) DEFAULT 0,
    selling_price DECIMAL(15, 2) DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES manufacturing_templates(id) ON DELETE CASCADE
);
