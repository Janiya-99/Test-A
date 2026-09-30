-- Migration 94: Add Extra_Charge and Extra_Charge_Label columns to grn table
ALTER TABLE grn
ADD COLUMN Extra_Charge DECIMAL(15, 2) DEFAULT 0,
ADD COLUMN Extra_Charge_Label VARCHAR(255) DEFAULT 'Delivery Charge';
