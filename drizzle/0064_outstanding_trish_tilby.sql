CREATE TABLE `document_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`exam_category` text NOT NULL,
	`subject` text DEFAULT '綜合' NOT NULL,
	`usage_type` text DEFAULT '教材檢索' NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`ai_search_enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_assignments_document_category_subject_unique` ON `document_assignments` (`document_id`,`exam_category`,`subject`);--> statement-breakpoint
CREATE INDEX `document_assignments_category_subject_idx` ON `document_assignments` (`exam_category`,`subject`);--> statement-breakpoint
CREATE TABLE `document_search_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`unit_type` text DEFAULT 'paragraph_window' NOT NULL,
	`hierarchy_path` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`sequence` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text DEFAULT '' NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_search_units_document_sequence_unique` ON `document_search_units` (`document_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `document_search_units_document_page_idx` ON `document_search_units` (`document_id`,`page_start`);