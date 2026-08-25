CREATE TABLE `activation_code_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_id` text,
	`batch_id` text,
	`actor_member_id` integer,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `activation_codes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`batch_id`) REFERENCES `activation_code_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activation_code_audit_code_created_idx` ON `activation_code_audit_logs` (`code_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activation_code_audit_actor_created_idx` ON `activation_code_audit_logs` (`actor_member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `activation_code_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`purpose` text NOT NULL,
	`benefit_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_by_member_id` integer,
	`created_by_email` text NOT NULL,
	`daily_limit` integer NOT NULL,
	`monthly_limit` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activation_code_batches_creator_created_idx` ON `activation_code_batches` (`created_by_member_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `selected_unit_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `selected_unit_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `created_by_member_id` integer REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `disabled_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `disabled_reason` text DEFAULT '' NOT NULL;