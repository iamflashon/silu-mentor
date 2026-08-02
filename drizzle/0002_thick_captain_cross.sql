CREATE TABLE `usage_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model` text NOT NULL,
	`source` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`file_search_calls` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
