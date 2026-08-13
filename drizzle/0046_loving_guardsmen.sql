ALTER TABLE `documents` ADD `exam_category` text DEFAULT 'law' NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_questions` ADD `exam_category` text DEFAULT 'law' NOT NULL;