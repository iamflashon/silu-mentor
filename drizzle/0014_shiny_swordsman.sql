CREATE TABLE `listening_solutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer,
	`title` text NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '刑法' NOT NULL,
	`question_text` text NOT NULL,
	`narration_script` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`audio_storage_key` text,
	`audio_file_name` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE set null
);
