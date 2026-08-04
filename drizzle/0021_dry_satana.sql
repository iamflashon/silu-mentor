CREATE TABLE `exam_coach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `exam_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
