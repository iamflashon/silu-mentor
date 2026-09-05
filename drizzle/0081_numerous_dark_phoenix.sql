CREATE TABLE `legal_search_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`question` text NOT NULL,
	`normalized_question` text NOT NULL,
	`source` text DEFAULT 'custom' NOT NULL,
	`asked_count` integer DEFAULT 1 NOT NULL,
	`first_asked_at` integer NOT NULL,
	`last_asked_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_search_questions_member_question_unique` ON `legal_search_questions` (`member_id`,`normalized_question`);--> statement-breakpoint
CREATE INDEX `legal_search_questions_member_time_idx` ON `legal_search_questions` (`member_id`,`last_asked_at`);--> statement-breakpoint
CREATE INDEX `legal_search_questions_source_count_idx` ON `legal_search_questions` (`source`,`asked_count`);--> statement-breakpoint
CREATE TABLE `legal_search_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`question` text NOT NULL,
	`normalized_question` text NOT NULL,
	`source` text DEFAULT 'custom' NOT NULL,
	`result_json` text NOT NULL,
	`planner` text DEFAULT '' NOT NULL,
	`direct_evidence_count` integer DEFAULT 0 NOT NULL,
	`total_unique_cases` integer DEFAULT 0 NOT NULL,
	`internal_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` text DEFAULT '0' NOT NULL,
	`searchable_cases` integer DEFAULT 0 NOT NULL,
	`reusable` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legal_search_runs_question_time_idx` ON `legal_search_runs` (`normalized_question`,`created_at`);--> statement-breakpoint
CREATE INDEX `legal_search_runs_member_time_idx` ON `legal_search_runs` (`member_id`,`created_at`);