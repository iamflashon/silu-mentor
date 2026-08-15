ALTER TABLE `exam_questions` ADD `simulated_answer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `simulated_explanation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `simulated_complete_explanation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `simulated_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `simulated_answer_status` text DEFAULT 'missing' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `simulated_teacher_note` text DEFAULT '' NOT NULL;