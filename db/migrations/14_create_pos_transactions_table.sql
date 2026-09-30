CREATE TABLE IF NOT EXISTS pos_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pos_id INT DEFAULT 0,
    registry_id INT NOT NULL,
    type ENUM('In', 'Out') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    description VARCHAR(255),
    payment_method VARCHAR(50) DEFAULT 'Cash',
    datetime DATETIME DEFAULT CURRENT_TIMESTAMP
);