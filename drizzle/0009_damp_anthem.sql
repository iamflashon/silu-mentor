CREATE TABLE `saved_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`subject` text DEFAULT '綜合' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`task_id` integer,
	`question_id` integer,
	`record_date` text NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`activity_type` text NOT NULL,
	`planned_minutes` integer DEFAULT 0 NOT NULL,
	`actual_minutes` integer DEFAULT 0 NOT NULL,
	`correct` integer,
	`reflection` text DEFAULT '' NOT NULL,
	`weakness` text DEFAULT '' NOT NULL,
	`next_step` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `study_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
