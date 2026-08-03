CREATE TABLE `listening_audio_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listening_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text DEFAULT 'audio/mpeg' NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`start_offset_seconds` integer DEFAULT 0 NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`listening_id`) REFERENCES `listening_solutions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `listening_subtitle_cues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listening_id` integer NOT NULL,
	`segment_id` integer,
	`start_seconds` integer NOT NULL,
	`end_seconds` integer NOT NULL,
	`text` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`listening_id`) REFERENCES `listening_solutions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `listening_audio_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
