ALTER TABLE `members` ADD `can_admin` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `members` SET `can_admin` = true, `role` = 'student' WHERE `role` = 'admin' OR lower(`email`) = 'iamflashon@gmail.com';
