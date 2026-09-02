CREATE TABLE `question_edit_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_category` text NOT NULL,
	`document_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`question_number` text DEFAULT '' NOT NULL,
	`editor_member_id` integer,
	`editor_email` text NOT NULL,
	`editor_name` text DEFAULT '' NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`editor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `question_edit_audits_editor_created_idx` ON `question_edit_audits` (`editor_email`,`created_at`);
--> statement-breakpoint
CREATE INDEX `question_edit_audits_document_created_idx` ON `question_edit_audits` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `question_edit_audits_question_created_idx` ON `question_edit_audits` (`question_id`,`created_at`);
