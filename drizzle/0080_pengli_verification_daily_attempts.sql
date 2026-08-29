CREATE TABLE `pengli_verification_daily_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`attempt_date` text NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pengli_verification_daily_member_date_unique` ON `pengli_verification_daily_attempts` (`member_id`,`attempt_date`);
--> statement-breakpoint
CREATE INDEX `pengli_verification_daily_date_idx` ON `pengli_verification_daily_attempts` (`attempt_date`);
