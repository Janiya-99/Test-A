-- Migration: Create Service Jobs Tables
-- Add Prefix and Start Number to rules table for auto-generation
ALTER TABLE rules
ADD COLUMN Service_Job_No_Start_With VARCHAR(45) DEFAULT 'JOB/SERV',
  ADD COLUMN Service_Job_No_Start_From INT(11) DEFAULT 1000;
-- Create service_jobs table
CREATE TABLE IF NOT EXISTS `service_jobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_no` varchar(100) NOT NULL,
  `date` date DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `contact_person` varchar(255) DEFAULT NULL,
  `service_details` text DEFAULT NULL,
  `contact_no` varchar(50) DEFAULT NULL,
  `mobile_no` varchar(50) DEFAULT NULL,
  `req_no` varchar(100) DEFAULT NULL,
  `manual_ref` varchar(100) DEFAULT NULL,
  `order_no` varchar(100) DEFAULT NULL,
  `other_ref` varchar(100) DEFAULT NULL,
  `technician_id` int(11) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `status` varchar(50) DEFAULT 'Pending',
  `branch_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
-- Create service_job_items table
CREATE TABLE IF NOT EXISTS `service_job_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `service_job_id` int(11) NOT NULL,
  `item_id` int(11) DEFAULT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `brand` varchar(255) DEFAULT NULL,
  `model` varchar(255) DEFAULT NULL,
  `serial_1` varchar(255) DEFAULT NULL,
  `warranty_no` varchar(255) DEFAULT NULL,
  `doc_date` date DEFAULT NULL,
  `warr_status` varchar(100) DEFAULT NULL,
  `defect_type` varchar(255) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
-- Create service_job_settings table
CREATE TABLE IF NOT EXISTS `service_job_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `header_type` varchar(50) DEFAULT 'text',
  `business_name` varchar(255) DEFAULT 'ADANS PLC',
  `address` text,
  `email` varchar(255) DEFAULT 'test@asipiya.com',
  `phone` varchar(50) DEFAULT '0115555888',
  `header_image` longtext,
  `terms_conditions` text,
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;