CREATE TABLE IF NOT EXISTS `document_section_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`section_key` text NOT NULL,
	`title` text NOT NULL,
	`section_type` text DEFAULT 'body' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pdf_start_page` integer NOT NULL,
	`pdf_end_page` integer NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `document_section_mappings_document_key_unique` ON `document_section_mappings` (`document_id`,`section_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_section_mappings_document_order_idx` ON `document_section_mappings` (`document_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_section_mappings_document_pages_idx` ON `document_section_mappings` (`document_id`,`pdf_start_page`,`pdf_end_page`);
