CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`source` text,
	`model` text,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`title` text DEFAULT '司律導師對話' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
