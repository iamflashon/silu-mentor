CREATE TABLE `member_account_deletion_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deletion_ref` text NOT NULL,
	`actor_type` text DEFAULT 'member_self_service' NOT NULL,
	`request_channel` text DEFAULT 'authenticated_member_portal' NOT NULL,
	`authentication_method` text DEFAULT 'session_password_confirmation_phrase' NOT NULL,
	`outcome` text DEFAULT 'started' NOT NULL,
	`ip_hash` text DEFAULT '' NOT NULL,
	`user_agent_hash` text DEFAULT '' NOT NULL,
	`retained_payment_orders` integer DEFAULT 0 NOT NULL,
	`payment_data_anonymized` integer DEFAULT false NOT NULL,
	`learning_data_deleted` integer DEFAULT false NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_account_deletion_audits_deletion_ref_unique` ON `member_account_deletion_audits` (`deletion_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_account_deletion_audits_ref_unique` ON `member_account_deletion_audits` (`deletion_ref`);--> statement-breakpoint
CREATE INDEX `member_account_deletion_audits_requested_idx` ON `member_account_deletion_audits` (`requested_at`);