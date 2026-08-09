CREATE TABLE `issue_practice_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`student_issues` text DEFAULT '' NOT NULL,
	`student_supplement` text DEFAULT '' NOT NULL,
	`sample_level` text,
	`luna_result_json` text,
	`sol_result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_practice_records_user_question_unique` ON `issue_practice_records` (`user_key`,`question_id`);