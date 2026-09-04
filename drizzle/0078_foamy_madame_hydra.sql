CREATE TABLE `posner_course_entitlements` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `member_id` integer NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
 `resource_id` integer NOT NULL REFERENCES `learning_resources`(`id`) ON DELETE cascade,
 `status` text DEFAULT 'active' NOT NULL,
 `source` text DEFAULT 'line_pay' NOT NULL,
 `starts_at` integer NOT NULL,
 `expires_at` integer NOT NULL,
 `reference` text DEFAULT '' NOT NULL,
 `created_at` integer NOT NULL,
 `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posner_entitlements_member_resource_unique` ON `posner_course_entitlements` (`member_id`,`resource_id`);
--> statement-breakpoint
CREATE INDEX `posner_entitlements_expiry_idx` ON `posner_course_entitlements` (`member_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `posner_course_products` (
 `resource_id` integer PRIMARY KEY NOT NULL REFERENCES `learning_resources`(`id`) ON DELETE cascade,
 `price` integer DEFAULT 0 NOT NULL,
 `access_days` integer DEFAULT 365 NOT NULL,
 `preview_start_seconds` integer DEFAULT 0 NOT NULL,
 `preview_duration_seconds` integer DEFAULT 300 NOT NULL,
 `sales_enabled` integer DEFAULT false NOT NULL,
 `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posner_course_vouchers` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `resource_id` integer NOT NULL REFERENCES `learning_resources`(`id`) ON DELETE cascade,
 `code` text NOT NULL,
 `access_days` integer NOT NULL,
 `status` text DEFAULT 'active' NOT NULL,
 `redeem_by` integer,
 `redeemed_at` integer,
 `redeemed_by_member_id` integer REFERENCES `members`(`id`) ON DELETE set null,
 `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posner_course_vouchers_code_unique` ON `posner_course_vouchers` (`code`);
--> statement-breakpoint
CREATE INDEX `posner_vouchers_resource_status_idx` ON `posner_course_vouchers` (`resource_id`,`status`);
--> statement-breakpoint
CREATE TABLE `posner_payment_orders` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `member_id` integer NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
 `resource_id` integer NOT NULL REFERENCES `learning_resources`(`id`) ON DELETE cascade,
 `order_id` text NOT NULL,
 `transaction_id` text,
 `environment` text DEFAULT 'sandbox' NOT NULL,
 `amount` integer NOT NULL,
 `currency` text DEFAULT 'TWD' NOT NULL,
 `status` text DEFAULT 'pending' NOT NULL,
 `title_snapshot` text NOT NULL,
 `access_days_snapshot` integer NOT NULL,
 `return_code` text,
 `return_message` text,
 `paid_at` integer,
 `created_at` integer NOT NULL,
 `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posner_payment_orders_order_id_unique` ON `posner_payment_orders` (`order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `posner_payment_orders_transaction_id_unique` ON `posner_payment_orders` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `posner_orders_member_created_idx` ON `posner_payment_orders` (`member_id`,`created_at`);
