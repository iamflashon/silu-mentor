CREATE TABLE `learning_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_type` text NOT NULL,
	`title` text NOT NULL,
	`subject` text DEFAULT '刑法' NOT NULL,
	`creator` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`document_id` integer,
	`cover_storage_key` text,
	`source_url` text DEFAULT '' NOT NULL,
	`access_type` text DEFAULT 'owned' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `resource_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` integer NOT NULL,
	`segment_type` text NOT NULL,
	`lesson_label` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`start_seconds` integer,
	`end_seconds` integer,
	`text` text DEFAULT '' NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
