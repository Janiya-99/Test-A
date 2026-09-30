-- Migration 134: Manufacturing Cards (BOM / Recipe Management)
-- Date: 2026-09-24

-- ──────────────────────────────────────────────────────
-- Table 1: Manufacturing Cards (BOM Master Records)
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacturing_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    card_code VARCHAR(45) NOT NULL,
    card_name VARCHAR(255) NOT NULL,
    branch_id INT NOT NULL,
    finished_item_id INT NOT NULL,
    finished_variation_id INT DEFAULT NULL,
    base_quantity DECIMAL(15, 4) NOT NULL DEFAULT 1.0000,
    unit VARCHAR(45) DEFAULT 'unit',
    note TEXT,
    is_active TINYINT DEFAULT 1,
    is_default TINYINT DEFAULT 0,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (finished_item_id) REFERENCES item(idItem) ON DELETE RESTRICT,
    INDEX idx_mc_branch (branch_id),
    INDEX idx_mc_item (finished_item_id, finished_variation_id, is_active)
);

-- ──────────────────────────────────────────────────────
-- Table 2: Manufacturing Card Items (BOM Line Items)
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacturing_card_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    card_id INT NOT NULL,
    item_id INT NOT NULL,
    variation_id INT DEFAULT NULL,
    standard_qty DECIMAL(15, 4) NOT NULL,
    unit VARCHAR(45) DEFAULT 'unit',
    scrap_percentage DECIMAL(5, 2) DEFAULT 0.00,
    cost DECIMAL(15, 2) DEFAULT 0.00,
    note VARCHAR(255) DEFAULT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES manufacturing_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES item(idItem) ON DELETE RESTRICT,
    INDEX idx_mci_card (card_id)
);

-- ──────────────────────────────────────────────────────
-- Table 3: Link Manufacturing Jobs to originating Card
-- ──────────────────────────────────────────────────────
ALTER TABLE manufacturing_jobs
ADD COLUMN manufacturing_card_id INT DEFAULT NULL,
ADD INDEX idx_mj_card (manufacturing_card_id);
