CREATE TABLE `medtech_device_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`device_key` text NOT NULL,
	`device_label` text DEFAULT '未知裝置' NOT NULL,
	`ip_hash` text DEFAULT '' NOT NULL,
	`user_agent_hash` text DEFAULT '' NOT NULL,
	`last_path` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_device_sessions_user_device_unique` ON `medtech_device_sessions` (`user_key`,`device_key`);--> statement-breakpoint
CREATE INDEX `medtech_device_sessions_user_status_idx` ON `medtech_device_sessions` (`user_key`,`status`);--> statement-breakpoint
CREATE INDEX `medtech_device_sessions_last_seen_idx` ON `medtech_device_sessions` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `medtech_security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`event_type` text NOT NULL,
	`outcome` text NOT NULL,
	`device_key` text DEFAULT '' NOT NULL,
	`device_label` text DEFAULT '未知裝置' NOT NULL,
	`ip_hash` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medtech_security_events_user_created_idx` ON `medtech_security_events` (`user_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `medtech_security_events_type_created_idx` ON `medtech_security_events` (`event_type`,`created_at`);