ALTER TABLE `resource_segments` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_segments` ADD `importance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_segments` ADD `recommended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `resource_segments` ADD `review_status` text DEFAULT 'draft' NOT NULL;