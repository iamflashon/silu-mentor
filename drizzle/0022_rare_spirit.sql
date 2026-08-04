ALTER TABLE `chat_sessions` ADD `context_type` text DEFAULT 'home' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `resource_id` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `segment_id` integer;