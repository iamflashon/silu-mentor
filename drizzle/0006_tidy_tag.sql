CREATE TABLE `exam_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`selected_answer` text,
	`correct` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exam_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_type` text NOT NULL,
	`year` text NOT NULL,
	`subject` text NOT NULL,
	`question_number` text NOT NULL,
	`stem` text NOT NULL,
	`options_json` text,
	`correct_answer` text,
	`explanation` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exam_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`label` text NOT NULL,
	`exam_type` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_sources_url_unique` ON `exam_sources` (`url`);