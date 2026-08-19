ALTER TABLE `exam_questions` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `reviewed_at` integer;