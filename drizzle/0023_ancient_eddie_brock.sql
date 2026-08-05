CREATE TABLE `learning_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`source_record_count` integer DEFAULT 0 NOT NULL,
	`source_latest_record_id` integer DEFAULT 0 NOT NULL,
	`status_label` text NOT NULL,
	`summary` text NOT NULL,
	`strengths_json` text DEFAULT '[]' NOT NULL,
	`gaps_json` text DEFAULT '[]' NOT NULL,
	`next_action` text NOT NULL,
	`recommendations_json` text DEFAULT '[]' NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
