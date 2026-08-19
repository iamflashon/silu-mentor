CREATE TABLE `member_exam_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`exam_category` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`can_admin` integer DEFAULT false NOT NULL,
	`class_name` text DEFAULT '未分班' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_exam_access_member_category_unique` ON `member_exam_access` (`member_id`,`exam_category`);--> statement-breakpoint
CREATE INDEX `member_exam_access_category_status_idx` ON `member_exam_access` (`exam_category`,`status`);