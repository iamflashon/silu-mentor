CREATE TABLE `exam_source_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`file_url` text NOT NULL,
	`title` text NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '綜合' NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `exam_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_source_items_file_url_unique` ON `exam_source_items` (`file_url`);--> statement-breakpoint
ALTER TABLE `exam_sources` ADD `discovered_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_sources` ADD `processed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_sources` ADD `question_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_sources` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `exam_sources` ADD `updated_at` integer DEFAULT 0 NOT NULL;
