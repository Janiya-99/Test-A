ALTER TABLE userdesignation 
  ADD COLUMN Custom_Configurations tinyint(1) DEFAULT 1,
  ADD COLUMN Advance_Report_Generation tinyint(1) DEFAULT 1,
  ADD COLUMN Invoice_Item_Reports tinyint(1) DEFAULT 1,
  ADD COLUMN Serial_No_Reports tinyint(1) DEFAULT 1,
  ADD COLUMN Customer_Return_Report tinyint(1) DEFAULT 1,
  ADD COLUMN Accounts tinyint(1) DEFAULT 1,
  ADD COLUMN Add_Accounts tinyint(1) DEFAULT 1,
  ADD COLUMN Delivery tinyint(1) DEFAULT 1,
  ADD COLUMN Cheque_Management tinyint(1) DEFAULT 1,
  ADD COLUMN Designations tinyint(1) DEFAULT 1;

ALTER TABLE user_privilages 
  ADD COLUMN Custom_Configurations tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Advance_Report_Generation tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Invoice_Item_Reports tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Serial_No_Reports tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Customer_Return_Report tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Accounts tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Add_Accounts tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Delivery tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Cheque_Management tinyint(4) NOT NULL DEFAULT 1,
  ADD COLUMN Designations tinyint(4) NOT NULL DEFAULT 1;
