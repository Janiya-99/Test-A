-- 1. Global Rule Setting Flag
ALTER TABLE `rules` 
  ADD COLUMN `enable_route_management` TINYINT(1) DEFAULT 0 NULL;

-- 2. Base Distribution Routes
CREATE TABLE IF NOT EXISTS `distribution_route` (
  `idRoute` INT AUTO_INCREMENT PRIMARY KEY,
  `Route_Code` VARCHAR(50) NOT NULL UNIQUE,
  `Route_Name` VARCHAR(150) NOT NULL,
  `Description` TEXT NULL,
  `Province` VARCHAR(100) NULL,
  `District` VARCHAR(100) NULL,
  `Cities` JSON NULL COMMENT 'Array of covered city names',
  `Start_Location` VARCHAR(255) NULL,
  `Start_Lat` DECIMAL(10, 8) NULL,
  `Start_Lng` DECIMAL(11, 8) NULL,
  `End_Location` VARCHAR(255) NULL,
  `End_Lat` DECIMAL(10, 8) NULL,
  `End_Lng` DECIMAL(11, 8) NULL,
  `Waypoints` JSON NULL COMMENT 'Array of [{lat, lng, name, stop_order}]',
  `Branch_idBranch` INT NOT NULL,
  `Default_Salesperson_Id` INT NULL,
  `Default_Driver_Id` INT NULL,
  `Vehicle_Number` VARCHAR(50) NULL,
  `Status` TINYINT(1) NOT NULL DEFAULT 1,
  `Created_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `Updated_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_route_branch` (`Branch_idBranch`),
  INDEX `idx_route_status` (`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Route-Customer Assignment (Permanent / Base Master Route mapping)
CREATE TABLE IF NOT EXISTS `route_has_customer` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `Route_idRoute` INT NOT NULL,
  `Customer_idCustomer` INT NOT NULL,
  `Stop_Order` INT NOT NULL DEFAULT 1,
  `Estimated_Visit_Time` VARCHAR(20) NULL,
  `Assigned_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_route_customer` (`Route_idRoute`, `Customer_idCustomer`),
  INDEX `idx_rhc_route` (`Route_idRoute`),
  INDEX `idx_rhc_customer` (`Customer_idCustomer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Route-User Assignment (Default Salesperson / Driver mappings)
CREATE TABLE IF NOT EXISTS `route_has_user` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `Route_idRoute` INT NOT NULL,
  `User_idUser` INT NOT NULL,
  `Role_Type` VARCHAR(50) NOT NULL DEFAULT 'Salesperson' COMMENT 'Salesperson | Driver | Assistant',
  `Assigned_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_route_user` (`Route_idRoute`, `User_idUser`, `Role_Type`),
  INDEX `idx_rhu_user` (`User_idUser`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Daily Route Assignment (Morning Dispatch Schedule)
CREATE TABLE IF NOT EXISTS `daily_route_assignment` (
  `idDaily_Assignment` INT AUTO_INCREMENT PRIMARY KEY,
  `Assignment_Date` DATE NOT NULL,
  `Route_idRoute` INT NOT NULL,
  `Salesperson_User_Id` INT NOT NULL,
  `Driver_User_Id` INT NULL,
  `Vehicle_Number` VARCHAR(50) NULL,
  `Status` VARCHAR(30) NOT NULL DEFAULT 'Scheduled' COMMENT 'Scheduled | In-Progress | Completed | Cancelled',
  `Notes` TEXT NULL,
  `Start_Time` DATETIME NULL,
  `End_Time` DATETIME NULL,
  `Branch_idBranch` INT NOT NULL,
  `Created_By` INT NULL,
  `Created_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `Updated_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_dra_date` (`Assignment_Date`),
  INDEX `idx_dra_salesperson` (`Salesperson_User_Id`, `Assignment_Date`),
  INDEX `idx_dra_driver` (`Driver_User_Id`, `Assignment_Date`),
  INDEX `idx_dra_route` (`Route_idRoute`, `Assignment_Date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Daily Route Customer Visit Manifest
CREATE TABLE IF NOT EXISTS `daily_route_customer` (
  `idDaily_Route_Customer` INT AUTO_INCREMENT PRIMARY KEY,
  `Daily_Assignment_id` INT NOT NULL,
  `Customer_idCustomer` INT NOT NULL,
  `Visit_Order` INT NOT NULL DEFAULT 1,
  `Visit_Status` VARCHAR(30) NOT NULL DEFAULT 'Pending' COMMENT 'Pending | Visited | Invoiced | Payment_Collected | Skipped | Rescheduled',
  `Check_In_Time` DATETIME NULL,
  `Check_Out_Time` DATETIME NULL,
  `Invoice_idInvoice` INT NULL,
  `Payment_Collected` DECIMAL(15, 2) DEFAULT 0.00,
  `Payment_Method` VARCHAR(50) NULL,
  `Feedback_Notes` TEXT NULL,
  `Created_At` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_drc_assignment` (`Daily_Assignment_id`),
  INDEX `idx_drc_customer` (`Customer_idCustomer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Add Route Reference to Customer & Invoice Tables
ALTER TABLE `customer` 
  ADD COLUMN `Route_idRoute` INT NULL DEFAULT NULL AFTER `Branch_idBranch`,
  ADD COLUMN `Latitude` DECIMAL(10, 8) NULL DEFAULT NULL AFTER `shippingCountry`,
  ADD COLUMN `Longitude` DECIMAL(11, 8) NULL DEFAULT NULL AFTER `Latitude`;

ALTER TABLE `invoice` 
  ADD COLUMN `Route_idRoute` INT NULL DEFAULT NULL AFTER `Employee_idEmployee`;

-- 8. Add Privileges to user_privilages
ALTER TABLE `user_privilages`
  ADD COLUMN `Route_Management` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Customer_Reports`,
  ADD COLUMN `Daily_Route_View` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Route_Management`;
