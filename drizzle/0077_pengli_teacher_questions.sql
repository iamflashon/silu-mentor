CREATE TABLE `pengli_teacher_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`conversation_key` text DEFAULT '' NOT NULL,
	`message_key` text NOT NULL,
	`topic` text DEFAULT '行政法' NOT NULL,
	`ai_reply` text NOT NULL,
	`student_question` text NOT NULL,
	`verification_result` text DEFAULT '' NOT NULL,
	`verification_sources_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'verified' NOT NULL,
	`teacher_reply` text DEFAULT '' NOT NULL,
	`teacher_replied_at` integer,
	`student_read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pengli_teacher_questions_member_status_idx` ON `pengli_teacher_questions` (`member_id`,`status`);
--> statement-breakpoint
CREATE INDEX `pengli_teacher_questions_status_created_idx` ON `pengli_teacher_questions` (`status`,`created_at`);
