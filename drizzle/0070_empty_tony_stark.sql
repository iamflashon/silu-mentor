PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activation_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`last4` text NOT NULL,
	`label` text NOT NULL,
	`benefit_type` text NOT NULL,
	`exam_category` text DEFAULT '' NOT NULL,
	`product_key` text DEFAULT '' NOT NULL,
	`quota` integer DEFAULT 0 NOT NULL,
	`duration_days` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'unused' NOT NULL,
	`redeem_by` integer,
	`redeemed_at` integer,
	`redeemed_by_member_id` integer,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`redeemed_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_activation_codes`("id", "code_hash", "last4", "label", "benefit_type", "exam_category", "product_key", "quota", "duration_days", "status", "redeem_by", "redeemed_at", "redeemed_by_member_id", "created_by", "created_at", "updated_at") SELECT "id", "code_hash", "last4", "label", "benefit_type", "exam_category", "product_key", "quota", "duration_days", "status", "redeem_by", "redeemed_at", "redeemed_by_member_id", "created_by", "created_at", "updated_at" FROM `activation_codes`;--> statement-breakpoint
DROP TABLE `activation_codes`;--> statement-breakpoint
ALTER TABLE `__new_activation_codes` RENAME TO `activation_codes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `activation_codes_code_hash_unique` ON `activation_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `activation_codes_status_created_idx` ON `activation_codes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `activation_codes_redeemed_member_idx` ON `activation_codes` (`redeemed_by_member_id`);--> statement-breakpoint
CREATE TABLE `__new_ai_access_entitlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`quota_total` integer DEFAULT 30 NOT NULL,
	`quota_used` integer DEFAULT 0 NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`reference_id` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ai_access_entitlements`("id", "member_id", "status", "source", "quota_total", "quota_used", "starts_at", "expires_at", "reference_id", "note", "created_at", "updated_at") SELECT "id", "member_id", "status", "source", "quota_total", "quota_used", "starts_at", "expires_at", "reference_id", "note", "created_at", "updated_at" FROM `ai_access_entitlements`;--> statement-breakpoint
DROP TABLE `ai_access_entitlements`;--> statement-breakpoint
ALTER TABLE `__new_ai_access_entitlements` RENAME TO `ai_access_entitlements`;--> statement-breakpoint
CREATE INDEX `ai_access_entitlements_member_expiry_idx` ON `ai_access_entitlements` (`member_id`,`expires_at`);