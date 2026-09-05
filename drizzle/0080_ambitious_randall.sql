CREATE TABLE `pengli_study_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`book_version` text NOT NULL,
	`tool` text NOT NULL,
	`topic` text NOT NULL,
	`parameters_json` text DEFAULT '{}' NOT NULL,
	`prompt_version` integer DEFAULT 1 NOT NULL,
	`content` text NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`generated_by_member_id` integer,
	`reuse_count` integer DEFAULT 0 NOT NULL,
	`generated_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`generated_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pengli_study_artifacts_cache_key_unique` ON `pengli_study_artifacts` (`cache_key`);--> statement-breakpoint
CREATE INDEX `pengli_study_artifacts_lookup_idx` ON `pengli_study_artifacts` (`tool`,`topic`,`status`);--> statement-breakpoint
CREATE INDEX `pengli_study_artifacts_review_idx` ON `pengli_study_artifacts` (`review_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `pengli_study_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`artifact_id` integer,
	`request_key` text NOT NULL,
	`book_version` text NOT NULL,
	`tool` text NOT NULL,
	`topic` text NOT NULL,
	`input_json` text DEFAULT '[]' NOT NULL,
	`output_text` text NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`cache_hit` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `pengli_study_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pengli_study_runs_member_request_unique` ON `pengli_study_runs` (`member_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `pengli_study_runs_member_created_idx` ON `pengli_study_runs` (`member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pengli_study_runs_artifact_idx` ON `pengli_study_runs` (`artifact_id`);
