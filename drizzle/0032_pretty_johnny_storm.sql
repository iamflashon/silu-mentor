CREATE TABLE `review_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`participant_mode` text DEFAULT 'ai-scholar' NOT NULL,
	`teacher_model` text NOT NULL,
	`scholar_models_json` text DEFAULT '[]' NOT NULL,
	`commentator_model` text DEFAULT 'gpt-5.6-sol' NOT NULL,
	`stage_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
