CREATE TABLE `medtech_member_entitlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`product_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_member_entitlements_member_product_unique` ON `medtech_member_entitlements` (`member_id`,`product_key`);--> statement-breakpoint
CREATE INDEX `medtech_member_entitlements_product_expiry_idx` ON `medtech_member_entitlements` (`product_key`,`expires_at`);--> statement-breakpoint
CREATE TABLE `medtech_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_key` text NOT NULL,
	`title` text NOT NULL,
	`list_price` integer DEFAULT 199 NOT NULL,
	`sale_price` integer,
	`sale_label` text DEFAULT '' NOT NULL,
	`sale_starts_at` integer,
	`sale_ends_at` integer,
	`access_days` integer DEFAULT 30 NOT NULL,
	`trial_questions` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_products_product_key_unique` ON `medtech_products` (`product_key`);--> statement-breakpoint
ALTER TABLE `member_exam_access` ADD `permissions_json` text DEFAULT '[]' NOT NULL;