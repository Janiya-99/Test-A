-- Add notify_person_id to appointments table
ALTER TABLE `appointments` 
ADD COLUMN `notify_person_id` INT DEFAULT NULL AFTER `participant_name`,
ADD CONSTRAINT `fk_appointments_notify_person` 
FOREIGN KEY (`notify_person_id`) REFERENCES `appointment_notify_people`(`id`) ON DELETE SET NULL;

-- Add index for better performance
CREATE INDEX `idx_notify_person_id` ON `appointments`(`notify_person_id`);
