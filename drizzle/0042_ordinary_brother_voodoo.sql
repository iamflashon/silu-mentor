ALTER TABLE `personal_issue_questions` ADD `image_storage_keys_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `personal_issue_questions` ADD `image_content_types_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `personal_issue_questions` ADD `ocr_parts_json` text DEFAULT '[]' NOT NULL;