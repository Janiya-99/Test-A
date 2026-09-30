-- Migration: Create PO Settings Table
-- This table stores per-branch customization for Purchase Order print templates

CREATE TABLE IF NOT EXISTS po_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    Branch_idBranch INT NOT NULL UNIQUE,
    header_color VARCHAR(20) DEFAULT '#1e293b',
    accent_color VARCHAR(20) DEFAULT '#6366f1',
    terms_and_conditions TEXT DEFAULT 'Payment is due within 30 days of the purchase order date. All prices are subject to change without prior notice. Goods remain the property of the seller until full payment is received.',
    footer_note VARCHAR(500) DEFAULT 'This is a computer-generated document. No signature required.',
    show_logo TINYINT(1) DEFAULT 1,
    show_terms TINYINT(1) DEFAULT 1,
    show_footer_note TINYINT(1) DEFAULT 1,
    show_vendor_address TINYINT(1) DEFAULT 1,
    show_expected_date TINYINT(1) DEFAULT 1,
    show_deadline_date TINYINT(1) DEFAULT 1,
    show_item_code TINYINT(1) DEFAULT 1,
    show_item_note TINYINT(1) DEFAULT 1,
    show_subtotal TINYINT(1) DEFAULT 1,
    show_discount TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
