CREATE TABLE `legal_research_cases` (`id` text PRIMARY KEY NOT NULL,`member_email` text NOT NULL,`title` text NOT NULL,`original_question` text NOT NULL,`facts_json` text DEFAULT '[]' NOT NULL,`final_conclusion` text DEFAULT '' NOT NULL,`status` text DEFAULT 'active' NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `legal_research_cases_member_updated_idx` ON `legal_research_cases` (`member_email`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `legal_research_messages` (`id` text PRIMARY KEY NOT NULL,`case_id` text NOT NULL,`role` text NOT NULL,`content_json` text NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`case_id`) REFERENCES `legal_research_cases`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `legal_research_messages_case_time_idx` ON `legal_research_messages` (`case_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `legal_research_sources` (`id` text PRIMARY KEY NOT NULL,`case_id` text NOT NULL,`source_type` text NOT NULL,`external_id` text NOT NULL,`title` text NOT NULL,`metadata_json` text DEFAULT '{}' NOT NULL,`quote` text DEFAULT '' NOT NULL,`ai_summary` text DEFAULT '' NOT NULL,`source_url` text DEFAULT '' NOT NULL,`full_text` text DEFAULT '' NOT NULL,`full_text_read` integer DEFAULT false NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`case_id`) REFERENCES `legal_research_cases`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_research_sources_case_external_unique` ON `legal_research_sources` (`case_id`,`source_type`,`external_id`);
--> statement-breakpoint
CREATE INDEX `legal_research_sources_case_idx` ON `legal_research_sources` (`case_id`);
--> statement-breakpoint
CREATE TABLE `legal_research_alerts` (`id` text PRIMARY KEY NOT NULL,`case_id` text NOT NULL,`code` text NOT NULL,`severity` text NOT NULL,`title` text NOT NULL,`message` text NOT NULL,`status` text DEFAULT 'pending' NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`case_id`) REFERENCES `legal_research_cases`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_research_alerts_case_code_unique` ON `legal_research_alerts` (`case_id`,`code`);
--> statement-breakpoint
CREATE INDEX `legal_research_alerts_case_status_idx` ON `legal_research_alerts` (`case_id`,`status`);
--> statement-breakpoint
CREATE TABLE `legal_research_searches` (`id` text PRIMARY KEY NOT NULL,`case_id` text NOT NULL,`source` text NOT NULL,`query` text NOT NULL,`status` text NOT NULL,`result_count` integer DEFAULT 0 NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`case_id`) REFERENCES `legal_research_cases`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `legal_research_searches_case_time_idx` ON `legal_research_searches` (`case_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `legal_research_charges` (`id` text PRIMARY KEY NOT NULL,`case_id` text NOT NULL,`scope_hash` text NOT NULL,`units` integer NOT NULL,`description` text NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`case_id`) REFERENCES `legal_research_cases`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_research_charges_case_scope_unique` ON `legal_research_charges` (`case_id`,`scope_hash`);
--> statement-breakpoint
CREATE INDEX `legal_research_charges_case_idx` ON `legal_research_charges` (`case_id`);
--> statement-breakpoint
PRAGMA optimize;
