ALTER TABLE `medtech_practice_sessions` ADD `status` text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE `medtech_practice_sessions` ADD `last_active_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `medtech_practice_sessions` ADD `last_question_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `medtech_practice_sessions` ADD `answer_details_json` text DEFAULT '[]' NOT NULL;
