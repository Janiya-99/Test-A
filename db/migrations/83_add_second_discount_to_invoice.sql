ALTER TABLE invoice
  ADD COLUMN Discount2_Type VARCHAR(45) DEFAULT NULL AFTER Discount_Amount,
  ADD COLUMN Discount2_Presentage VARCHAR(45) DEFAULT NULL AFTER Discount2_Type,
  ADD COLUMN Discount2_Amount VARCHAR(45) DEFAULT NULL AFTER Discount2_Presentage;
