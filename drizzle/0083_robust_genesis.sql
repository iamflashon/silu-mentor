CREATE TABLE `pengli_study_audio_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`audio_storage_key` text,
	`audio_file_name` text,
	`audio_content_type` text,
	`audio_size_bytes` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `pengli_study_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pengli_study_audio_segments_artifact_position_idx` ON `pengli_study_audio_segments` (`artifact_id`,`position`);