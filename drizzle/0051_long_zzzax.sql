CREATE TABLE `medtech_ai_explanation_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`level` text DEFAULT '入門' NOT NULL,
	`reply` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_ai_explanation_cache_cache_key_unique` ON `medtech_ai_explanation_cache` (`cache_key`);--> statement-breakpoint
CREATE TABLE `medtech_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`audio_trial_question_ids_json` text DEFAULT '[]' NOT NULL,
	`ai_credits` integer DEFAULT 10 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_usage_user_key_unique` ON `medtech_usage` (`user_key`);--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `voice_script` text DEFAULT '' NOT NULL;