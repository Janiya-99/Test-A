-- Migration: Create Estimate Tables
-- Create estimate_settings table
CREATE TABLE IF NOT EXISTS `estimate_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `insurance_label` varchar(100) DEFAULT 'Insurance Company',
  `max_photos` int(11) DEFAULT 5,
  `show_company_logo` tinyint(4) DEFAULT 1,
  `show_terms` tinyint(4) DEFAULT 1,
  `terms_conditions` text DEFAULT NULL,
  `prefix` varchar(50) DEFAULT 'EST',
  `next_number` int(11) DEFAULT 1000,
  `show_name` tinyint(4) DEFAULT 1,
  `show_address` tinyint(4) DEFAULT 1,
  `show_phone` tinyint(4) DEFAULT 1,
  `show_email` tinyint(4) DEFAULT 1,
  `show_website` tinyint(4) DEFAULT 1,
  `show_vat_no` tinyint(4) DEFAULT 1,
  `show_reg_no` tinyint(4) DEFAULT 1,
  `show_reference_section` tinyint(4) DEFAULT 1,
  `show_insurance_field` tinyint(4) DEFAULT 1,
  `show_status_field` tinyint(4) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create estimate_insurance_companies table
CREATE TABLE IF NOT EXISTS `estimate_insurance_companies` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create estimates table
CREATE TABLE IF NOT EXISTS `estimates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_no` varchar(100) NOT NULL,
  `date` date DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `insurance_company_id` int(11) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `status` varchar(50) DEFAULT 'Pending',
  `branch_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`),
  KEY `customer_id` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create estimate_items table
CREATE TABLE IF NOT EXISTS `estimate_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `qty` decimal(10,2) DEFAULT 1.00,
  `unit_price` decimal(10,2) DEFAULT 0.00,
  `total_amount` decimal(10,2) DEFAULT 0.00,
  `remarks` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `estimate_id` (`estimate_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create estimate_photos table
CREATE TABLE IF NOT EXISTS `estimate_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `photo_path` varchar(512) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `estimate_id` (`estimate_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
