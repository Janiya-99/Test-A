-- Create quotation_header_settings table
CREATE TABLE IF NOT EXISTS `quotation_header_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Branch_idBranch` int(11) NOT NULL,
  `header_type` varchar(50) DEFAULT 'text',
  `business_name` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `website` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `bill_to` varchar(255) DEFAULT NULL,
  `ship_to` varchar(255) DEFAULT NULL,
  `datee` datetime DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `additional_note` text DEFAULT NULL,
  `visibility` text DEFAULT NULL,
  `fontSizes` text DEFAULT NULL,
  `header_image` longtext DEFAULT NULL,
  `company_reg` varchar(100) DEFAULT NULL,
  `payment_method` varchar(255) DEFAULT NULL,
  `terms` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Branch_idBranch` (`Branch_idBranch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create quotation_footer_settings table
CREATE TABLE IF NOT EXISTS `quotation_footer_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Branch_idBranch` int(11) NOT NULL,
  `footer_type` varchar(50) DEFAULT 'text',
  `footer_image` longtext DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `payment_details` text DEFAULT NULL,
  `footer_text` text DEFAULT NULL,
  `visibility` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Branch_idBranch` (`Branch_idBranch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create quotation_table_settings table
CREATE TABLE IF NOT EXISTS `quotation_table_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Branch_idBranch` int(11) NOT NULL,
  `show_invoice` tinyint(1) DEFAULT 1,
  `selected_columns` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Branch_idBranch` (`Branch_idBranch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create quotation_main_settings table
CREATE TABLE IF NOT EXISTS `quotation_main_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Branch_idBranch` int(11) NOT NULL,
  `template` varchar(50) DEFAULT 'Classic',
  `theme_color` varchar(20) DEFAULT '#000000',
  `text_color` varchar(20) DEFAULT '#A7C7E7',
  `print_margins` text DEFAULT NULL,
  `paper_size` text DEFAULT NULL,
  `logo_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Branch_idBranch` (`Branch_idBranch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
