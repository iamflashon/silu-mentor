PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`title` text DEFAULT '司律備考對話' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_chat_sessions`("id", "user_key", "title", "created_at", "updated_at") SELECT "id", "user_key", "title", "created_at", "updated_at" FROM `chat_sessions`;--> statement-breakpoint
DROP TABLE `chat_sessions`;--> statement-breakpoint
ALTER TABLE `__new_chat_sessions` RENAME TO `chat_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `exam_attempts` ADD `answer_text` text;--> statement-breakpoint
ALTER TABLE `exam_attempts` ADD `grading_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `teacher_answer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `teacher_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `rubric_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `answer_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `answer_status` text DEFAULT 'missing' NOT NULL;