CREATE TABLE `mcp_enterprises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`monthly_call_limit` integer DEFAULT 10000 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_enterprises_code_unique` ON `mcp_enterprises` (`code`);--> statement-breakpoint
CREATE INDEX `mcp_enterprises_status_idx` ON `mcp_enterprises` (`status`);--> statement-breakpoint
CREATE TABLE `mcp_access_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` integer,
	`email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`account_type` text DEFAULT 'individual' NOT NULL,
	`enterprise_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`daily_call_limit` integer DEFAULT 100 NOT NULL,
	`scopes_json` text DEFAULT '["resources.read","progress.read"]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`enterprise_id`) REFERENCES `mcp_enterprises`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_access_accounts_email_unique` ON `mcp_access_accounts` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_access_accounts_member_unique` ON `mcp_access_accounts` (`member_id`);--> statement-breakpoint
CREATE INDEX `mcp_access_accounts_enterprise_status_idx` ON `mcp_access_accounts` (`enterprise_id`,`status`);--> statement-breakpoint
CREATE TABLE `mcp_knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT '一般' NOT NULL,
	`content` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_knowledge_items_status_updated_idx` ON `mcp_knowledge_items` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `mcp_knowledge_items_category_status_idx` ON `mcp_knowledge_items` (`category`,`status`);--> statement-breakpoint
PRAGMA optimize;
