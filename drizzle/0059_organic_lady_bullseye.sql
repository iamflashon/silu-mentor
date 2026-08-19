CREATE TABLE `medtech_practice_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`package_name` text NOT NULL,
	`package_type` text DEFAULT 'chapter' NOT NULL,
	`question_ids_json` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`total_questions` integer DEFAULT 0 NOT NULL,
	`answered_questions` integer DEFAULT 0 NOT NULL,
	`correct_questions` integer DEFAULT 0 NOT NULL,
	`incorrect_question_ids_json` text DEFAULT '[]' NOT NULL,
	`repeated_wrong_question_ids_json` text DEFAULT '[]' NOT NULL,
	`weaknesses_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medtech_practice_sessions_user_created_idx` ON `medtech_practice_sessions` (`user_key`,`created_at`);