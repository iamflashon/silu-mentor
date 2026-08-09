ALTER TABLE `message_feedback` ADD `rating` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `error_types_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `student_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `original_prompt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `sol_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `sol_review` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `teacher_decision` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `teacher_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `corrected_content` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `updated_at` integer NOT NULL;