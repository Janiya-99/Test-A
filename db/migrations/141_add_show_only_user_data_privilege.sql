-- Migration 135: Add Show_Only_User_Data privilege to user_privilages
ALTER TABLE `user_privilages`
  ADD COLUMN `Show_Only_User_Data` TINYINT(4) NOT NULL DEFAULT 0 AFTER `Daily_Route_View`;
