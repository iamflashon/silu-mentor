CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `openai_file_id` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `index_error` text;