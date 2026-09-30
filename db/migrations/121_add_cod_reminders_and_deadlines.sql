ALTER TABLE invoice ADD COLUMN cod_collection_deadline DATE NULL;
ALTER TABLE invoice ADD COLUMN cod_status VARCHAR(50) DEFAULT 'Pending';
ALTER TABLE appointments ADD COLUMN is_cod_reminder TINYINT DEFAULT 0;
