-- Migration 120: Add Wallet Subcategories

CREATE TABLE IF NOT EXISTS `wallet_sub_category` (
  `idWallet_SubCategory` int(11) NOT NULL AUTO_INCREMENT,
  `Description` varchar(255) DEFAULT NULL,
  `Wallet_Category_idWallet_Category` int(11) NOT NULL,
  `Branch_idBranch` int(11) NOT NULL,
  PRIMARY KEY (`idWallet_SubCategory`),
  KEY `fk_Wallet_SubCategory_Category` (`Wallet_Category_idWallet_Category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `wallet` ADD COLUMN `Wallet_SubCategory_id` int(11) DEFAULT NULL;
