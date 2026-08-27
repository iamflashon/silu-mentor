CREATE TABLE `accounting_qa_trial_devices` (
  `device_key` text PRIMARY KEY NOT NULL,
  `ip_hash` text DEFAULT '' NOT NULL,
  `user_agent_hash` text DEFAULT '' NOT NULL,
  `used_count` integer DEFAULT 0 NOT NULL,
  `bonus_count` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_qa_trial_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `device_key` text NOT NULL,
  `display_name` text DEFAULT '' NOT NULL,
  `email` text DEFAULT '' NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `grant_count` integer DEFAULT 0 NOT NULL,
  `requested_at` integer NOT NULL,
  `resolved_at` integer,
  `resolved_by` text DEFAULT '' NOT NULL,
  FOREIGN KEY (`device_key`) REFERENCES `accounting_qa_trial_devices`(`device_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounting_qa_trial_requests_status_requested_idx` ON `accounting_qa_trial_requests` (`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `accounting_qa_trial_requests_device_idx` ON `accounting_qa_trial_requests` (`device_key`);
