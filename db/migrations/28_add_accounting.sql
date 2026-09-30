CREATE TABLE `accounting_accounts` (
    `idAccounting_Accounts` int NOT NULL AUTO_INCREMENT,
    `Account_Type` varchar(45) DEFAULT NULL,
    `Account_Name` varchar(255) DEFAULT NULL,
    `Account_Code` varchar(45) DEFAULT NULL,
    `Type` varchar(45) DEFAULT NULL,
    `Group_Of_Type` varchar(45) DEFAULT NULL,
    `Account_Balance` varchar(45) DEFAULT '0',
    `Branch_idBranch` int NOT NULL,
    `Account_Number` varchar(200) DEFAULT NULL,
    `Status` INT DEFAULT 1,
    `User_idUser` INT DEFAULT NULL,
    `Parent_Account` INT DEFAULT NULL,
    `Created_At` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `Description` varchar(255) DEFAULT NULL,
    `CompanySoftware_IdCompanySoftware` int DEFAULT NULL,
    `companyId` int DEFAULT NULL,
    PRIMARY KEY (`idAccounting_Accounts`)
) ENGINE = InnoDB DEFAULT CHARSET = latin1;
CREATE TABLE `accounting_accounts_log` (
    `idAccounting_Accounts_Log` INT NOT NULL AUTO_INCREMENT,
    `Accounting_Accounts_idAccounting_Accounts` INT NOT NULL,
    `Date_Time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `Type` LONGTEXT,
    `Description` VARCHAR(545) DEFAULT NULL,
    `Debit` DECIMAL(15, 2) DEFAULT 0.00,
    `Credit` DECIMAL(15, 2) DEFAULT 0.00,
    `Balance` DECIMAL(15, 2) DEFAULT 0.00,
    `User_idUser` INT NOT NULL,
    `CompanySoftware_IdCompanySoftware` INT DEFAULT NULL,
    `branchId` INT DEFAULT NULL,
    `companyId` INT DEFAULT NULL,
    PRIMARY KEY (`idAccounting_Accounts_Log`)
) ENGINE = InnoDB DEFAULT CHARSET = latin1;