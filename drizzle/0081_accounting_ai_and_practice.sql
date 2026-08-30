CREATE TABLE `accounting_ai_entitlements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `member_id` integer NOT NULL UNIQUE,
  `quota_total` integer DEFAULT 30 NOT NULL,
  `quota_used` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `starts_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `source` text DEFAULT 'line_pay' NOT NULL,
  `reference_id` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounting_ai_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `entitlement_id` integer NOT NULL,
  `member_id` integer NOT NULL,
  `request_key` text NOT NULL,
  `delta` integer DEFAULT -1 NOT NULL,
  `balance_after` integer NOT NULL,
  `description` text DEFAULT '中會課業答疑' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`entitlement_id`) REFERENCES `accounting_ai_entitlements`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_ai_ledger_request_unique` ON `accounting_ai_ledger` (`member_id`,`request_key`);
--> statement-breakpoint
CREATE TABLE `accounting_practice_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `member_id` integer NOT NULL,
  `question_id` integer NOT NULL,
  `chapter_number` integer NOT NULL,
  `selected_answer` text NOT NULL,
  `correct_answer` text NOT NULL,
  `is_correct` integer NOT NULL,
  `elapsed_seconds` integer DEFAULT 0 NOT NULL,
  `practice_mode` text DEFAULT 'ordered' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounting_attempts_member_created_idx` ON `accounting_practice_attempts` (`member_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `accounting_attempts_member_question_idx` ON `accounting_practice_attempts` (`member_id`,`question_id`);
