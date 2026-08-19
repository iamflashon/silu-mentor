CREATE TABLE `organized_note_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`model` text NOT NULL,
	`note_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organized_note_cache_cache_key_unique` ON `organized_note_cache` (`cache_key`);--> statement-breakpoint
ALTER TABLE `saved_notes` ADD `original_content` text DEFAULT '' NOT NULL;