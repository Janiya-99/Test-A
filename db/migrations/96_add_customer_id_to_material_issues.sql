ALTER TABLE material_issue_notes
ADD COLUMN customer_id INT NULL,
MODIFY COLUMN issued_for_type ENUM('project','general','internal','customer') NOT NULL DEFAULT 'general';
