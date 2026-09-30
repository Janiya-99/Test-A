CREATE TABLE IF NOT EXISTS `supplier_contact_numbers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Supplier_idSupplier` int(11) NOT NULL,
  `Contact_Name` varchar(255) DEFAULT NULL,
  `Contact_Number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_supplier_contact_numbers_supplier_idx` (`Supplier_idSupplier`),
  CONSTRAINT `fk_supplier_contact_numbers_supplier` FOREIGN KEY (`Supplier_idSupplier`) REFERENCES `supplier` (`idSupplier`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
