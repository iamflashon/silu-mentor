ALTER TABLE `pengli_teacher_questions` ADD `assigned_teacher_id` integer REFERENCES `members`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `pengli_teacher_questions` ADD `admin_reviewed_at` integer;
--> statement-breakpoint
ALTER TABLE `pengli_teacher_questions` ADD `assigned_at` integer;
--> statement-breakpoint
CREATE INDEX `pengli_teacher_questions_teacher_status_idx` ON `pengli_teacher_questions` (`assigned_teacher_id`,`status`);
