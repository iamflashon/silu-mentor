ALTER TABLE `documents` ADD `processing_stage` text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `processing_message` text DEFAULT '等待自動處理' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `file_sha256` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `page_count` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `extracted_chars` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `chapter_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `question_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `processing_result_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `full_text_indexed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `vector_indexed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `processed_at` integer;