CREATE TABLE `legal_search_access` (
	`member_id` integer PRIMARY KEY NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`temporary_quota` integer DEFAULT 0 NOT NULL,
	`temporary_expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `legal_search_access_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`requested_quota` integer DEFAULT 10 NOT NULL,
	`requested_days` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legal_search_requests_status_idx` ON `legal_search_access_requests` (`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `legal_search_requests_member_idx` ON `legal_search_access_requests` (`member_id`);
