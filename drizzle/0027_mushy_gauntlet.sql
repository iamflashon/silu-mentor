CREATE TABLE `note_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`user_key` text NOT NULL,
	`kind` text DEFAULT 'screenshot' NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text DEFAULT 'image/jpeg' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`episode_title` text DEFAULT '' NOT NULL,
	`position_seconds` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `saved_notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_attachments_storage_key_unique` ON `note_attachments` (`storage_key`);