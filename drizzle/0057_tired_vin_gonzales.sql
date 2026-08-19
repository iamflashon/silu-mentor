CREATE TABLE `medtech_point_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`action` text NOT NULL,
	`description` text NOT NULL,
	`question_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medtech_point_ledger_user_created_idx` ON `medtech_point_ledger` (`user_key`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_medtech_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`audio_trial_question_ids_json` text DEFAULT '[]' NOT NULL,
	`ai_credits` integer DEFAULT 10 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_medtech_usage`("id", "user_key", "audio_trial_question_ids_json", "ai_credits", "updated_at") SELECT "id", "user_key", "audio_trial_question_ids_json", "ai_credits", "updated_at" FROM `medtech_usage`;--> statement-breakpoint
DROP TABLE `medtech_usage`;--> statement-breakpoint
ALTER TABLE `__new_medtech_usage` RENAME TO `medtech_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_usage_user_key_unique` ON `medtech_usage` (`user_key`);