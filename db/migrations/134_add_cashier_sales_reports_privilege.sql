ALTER TABLE userdesignation
  ADD COLUMN Cashier_Sales_Reports tinyint(1) DEFAULT 1;

ALTER TABLE user_privilages
  ADD COLUMN Cashier_Sales_Reports tinyint(4) NOT NULL DEFAULT 1;
