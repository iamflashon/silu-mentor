PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_medtech_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`audio_trial_question_ids_json` text DEFAULT '[]' NOT NULL,
	`ai_credits` integer DEFAULT 30 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_medtech_usage`("id", "user_key", "audio_trial_question_ids_json", "ai_credits", "updated_at") SELECT "id", "user_key", "audio_trial_question_ids_json", "ai_credits", "updated_at" FROM `medtech_usage`;--> statement-breakpoint
DROP TABLE `medtech_usage`;--> statement-breakpoint
ALTER TABLE `__new_medtech_usage` RENAME TO `medtech_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `medtech_usage_user_key_unique` ON `medtech_usage` (`user_key`);