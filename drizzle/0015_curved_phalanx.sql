CREATE TABLE `judicial_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text NOT NULL,
	`court` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`case_type` text DEFAULT '' NOT NULL,
	`case_no` text DEFAULT '' NOT NULL,
	`judgment_date` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`full_text` text DEFAULT '' NOT NULL,
	`raw_json` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `judicial_cases_jid_unique` ON `judicial_cases` (`jid`);--> statement-breakpoint
CREATE TABLE `legal_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`article_no` text NOT NULL,
	`hierarchy` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `legal_data_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`source_url` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`import_cursor` integer DEFAULT 0 NOT NULL,
	`total_available` integer DEFAULT 0 NOT NULL,
	`archive_storage_key` text,
	`last_error` text,
	`last_downloaded_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_data_sources_source_key_unique` ON `legal_data_sources` (`source_key`);--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`modified_date` text DEFAULT '' NOT NULL,
	`effective_date` text DEFAULT '' NOT NULL,
	`history` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_documents_external_id_unique` ON `legal_documents` (`external_id`);