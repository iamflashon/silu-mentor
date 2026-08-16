CREATE TABLE `medtech_question_evidence_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`reviewer` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'openai_web_search' NOT NULL,
	`query_text` text DEFAULT '' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medtech_question_evidence_reviews_question_idx` ON `medtech_question_evidence_reviews` (`question_id`,`created_at`);