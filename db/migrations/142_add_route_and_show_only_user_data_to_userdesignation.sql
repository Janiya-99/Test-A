-- Migration 136: Add Route_Management, Daily_Route_View, and Show_Only_User_Data to userdesignation table
ALTER TABLE `userdesignation`
  ADD COLUMN `Route_Management` TINYINT(4) NOT NULL DEFAULT 0 AFTER `POS`,
  ADD COLUMN `Daily_Route_View` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Route_Management`,
  ADD COLUMN `Show_Only_User_Data` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Daily_Route_View`;
