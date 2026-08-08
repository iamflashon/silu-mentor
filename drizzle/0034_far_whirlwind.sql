CREATE TABLE `learning_preferences` (
	`user_key` text PRIMARY KEY NOT NULL,
	`book_teaching_level` text,
	`book_model_mode` text DEFAULT 'luna' NOT NULL,
	`book_settings_pinned` integer DEFAULT false NOT NULL,
	`last_book_resource_id` integer,
	`last_book_segment_id` integer,
	`last_book_session_id` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`last_book_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
