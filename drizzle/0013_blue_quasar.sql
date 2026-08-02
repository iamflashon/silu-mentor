CREATE TABLE `message_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`session_id` integer,
	`message_index` integer DEFAULT 0 NOT NULL,
	`feedback_type` text NOT NULL,
	`message_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
