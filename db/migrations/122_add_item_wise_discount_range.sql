ALTER TABLE item 
ADD COLUMN discount_min DOUBLE DEFAULT 0, 
ADD COLUMN discount_max DOUBLE DEFAULT 0, 
ADD COLUMN discount_type VARCHAR(20) DEFAULT 'percentage';
