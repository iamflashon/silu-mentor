ALTER TABLE `chat_sessions` ADD `session_date` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `progress_status` text DEFAULT 'open' NOT NULL;