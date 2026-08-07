CREATE TABLE `guided_practice_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`mode` text DEFAULT 'guided' NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`state_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guided_practice_user_question_idx` ON `guided_practice_sessions` (`user_key`,`question_id`);