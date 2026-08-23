CREATE TABLE `member_password_reset_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`completed_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_password_reset_requests_member_status_idx` ON `member_password_reset_requests` (`member_id`,`status`);--> statement-breakpoint
CREATE INDEX `member_password_reset_requests_requested_idx` ON `member_password_reset_requests` (`requested_at`);