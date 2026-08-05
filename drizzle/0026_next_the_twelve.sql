CREATE TABLE `my_courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_key` text NOT NULL,
	`title` text NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text DEFAULT 'video' NOT NULL,
	`playlist_id` text,
	`video_id` text,
	`subject` text DEFAULT '綜合' NOT NULL,
	`exam_type` text DEFAULT '一試／二試' NOT NULL,
	`scope` text DEFAULT '全科' NOT NULL,
	`relevance_label` text DEFAULT '待確認' NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
