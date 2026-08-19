CREATE TABLE `chat_comparison_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comparison_id` integer NOT NULL,
	`response_id` integer NOT NULL,
	`user_key` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`feedback_type` text DEFAULT 'rated' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comparison_id`) REFERENCES `chat_comparisons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`response_id`) REFERENCES `chat_comparison_responses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_comparison_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comparison_id` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`label` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'AI 補充' NOT NULL,
	`citations_json` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comparison_id`) REFERENCES `chat_comparisons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_comparisons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`session_id` integer,
	`context_type` text DEFAULT 'home' NOT NULL,
	`prompt_text` text NOT NULL,
	`source_status` text DEFAULT 'unavailable' NOT NULL,
	`source_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
