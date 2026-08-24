CREATE TABLE `activation_codes` (
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
CREATE UNIQUE INDEX `activation_codes_code_hash_unique` ON `activation_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `activation_codes_status_created_idx` ON `activation_codes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `activation_codes_redeemed_member_idx` ON `activation_codes` (`redeemed_by_member_id`);--> statement-breakpoint
CREATE TABLE `ai_access_entitlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer,
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
CREATE INDEX `ai_access_entitlements_member_expiry_idx` ON `ai_access_entitlements` (`member_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `ai_access_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entitlement_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`action` text NOT NULL,
	`request_key` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entitlement_id`) REFERENCES `ai_access_entitlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_access_ledger_request_unique` ON `ai_access_ledger` (`member_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `ai_access_ledger_member_created_idx` ON `ai_access_ledger` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_payment_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`order_id` text NOT NULL,
	`transaction_id` text,
	`environment` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'TWD' NOT NULL,
	`quota` integer NOT NULL,
	`duration_days` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`return_code` text,
	`return_message` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_payment_orders_order_id_unique` ON `ai_payment_orders` (`order_id`);--> statement-breakpoint
CREATE INDEX `ai_payment_orders_member_created_idx` ON `ai_payment_orders` (`member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_payment_orders_status_created_idx` ON `ai_payment_orders` (`status`,`created_at`);
