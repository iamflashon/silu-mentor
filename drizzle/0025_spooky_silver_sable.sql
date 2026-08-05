CREATE TABLE `course_collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`resource_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `course_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `course_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `learning_resources` (`resource_type`, `title`, `subject`, `creator`, `description`, `source_url`, `access_type`, `status`, `sort_order`, `created_at`, `updated_at`)
SELECT 'course', '台大開放課程｜刑法', '刑法', '王皇玉老師', '以大學公開課程建立刑法體系，適合在準備司律考試前補足觀念與基礎脈絡。', 'https://www.youtube.com/watch?v=GrVwxdKu6mA&list=PLCX-BLZ1hDpAgv7suDt-78aDAN0opbyxY', 'full', 'active', 0, unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (
	SELECT 1 FROM `learning_resources`
	WHERE `resource_type` = 'course'
	  AND `source_url` = 'https://www.youtube.com/watch?v=GrVwxdKu6mA&list=PLCX-BLZ1hDpAgv7suDt-78aDAN0opbyxY'
);
--> statement-breakpoint
INSERT INTO `course_collections` (`title`, `description`, `status`, `sort_order`, `created_at`, `updated_at`)
SELECT '台大開放課程', '整理各科大學公開課程，作為司律備考的補充學習資源。', 'active', 0, unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (
	SELECT 1 FROM `course_collections` WHERE `title` = '台大開放課程'
);
--> statement-breakpoint
INSERT INTO `course_collection_items` (`collection_id`, `resource_id`, `sort_order`, `created_at`, `updated_at`)
SELECT cc.`id`, lr.`id`, 0, unixepoch() * 1000, unixepoch() * 1000
FROM `course_collections` cc
JOIN `learning_resources` lr
	ON lr.`resource_type` = 'course'
	AND lr.`source_url` = 'https://www.youtube.com/watch?v=GrVwxdKu6mA&list=PLCX-BLZ1hDpAgv7suDt-78aDAN0opbyxY'
WHERE cc.`title` = '台大開放課程'
  AND NOT EXISTS (
	SELECT 1 FROM `course_collection_items` item
	WHERE item.`collection_id` = cc.`id` AND item.`resource_id` = lr.`id`
);
