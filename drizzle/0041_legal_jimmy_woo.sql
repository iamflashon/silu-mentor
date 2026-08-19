CREATE TABLE `personal_issue_practice_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`personal_question_id` integer NOT NULL,
	`student_issues` text DEFAULT '' NOT NULL,
	`ai_result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`personal_question_id`) REFERENCES `personal_issue_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_issue_records_user_question_unique` ON `personal_issue_practice_records` (`user_key`,`personal_question_id`);--> statement-breakpoint
CREATE TABLE `personal_issue_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`title` text NOT NULL,
	`subject` text DEFAULT '未分類' NOT NULL,
	`source_label` text DEFAULT '我的書籍' NOT NULL,
	`question_text` text NOT NULL,
	`image_storage_key` text,
	`image_content_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personal_issue_questions_user_updated_idx` ON `personal_issue_questions` (`user_key`,`updated_at`);--> statement-breakpoint
CREATE INDEX `personal_issue_questions_user_subject_idx` ON `personal_issue_questions` (`user_key`,`subject`);