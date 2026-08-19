CREATE TABLE `legal_explanation_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`model` text NOT NULL,
	`explanation` text NOT NULL,
	`analysis_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_explanation_cache_cache_key_unique` ON `legal_explanation_cache` (`cache_key`);