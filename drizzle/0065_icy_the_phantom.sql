CREATE TABLE `medtech_payment_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`order_id` text NOT NULL,
	`transaction_id` text,
	`provider` text DEFAULT 'line_pay' NOT NULL,
	`environment` text DEFAULT 'sandbox' NOT NULL,
	`package_name` text NOT NULL,
	`pack_number` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'TWD' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`return_code` text,
	`return_message` text,
	`paid_at` integer,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_payment_orders_order_id_unique` ON `medtech_payment_orders` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_payment_orders_transaction_id_unique` ON `medtech_payment_orders` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `medtech_payment_orders_user_created_idx` ON `medtech_payment_orders` (`user_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `medtech_payment_orders_package_status_idx` ON `medtech_payment_orders` (`user_key`,`package_name`,`pack_number`,`status`);