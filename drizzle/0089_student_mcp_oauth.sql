CREATE TABLE `mcp_coach_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` integer NOT NULL,
	`user_key` text NOT NULL,
	`summary` text NOT NULL,
	`weak_spot` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`completed_tasks` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'chatgpt_mcp' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_coach_checkins_member_created_idx` ON `mcp_coach_checkins` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_authorization_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`member_id` integer NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text DEFAULT 'resources.read progress.read progress.write' NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_oauth_codes_client_expires_idx` ON `mcp_oauth_authorization_codes` (`client_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_codes_member_created_idx` ON `mcp_oauth_authorization_codes` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text DEFAULT 'ChatGPT' NOT NULL,
	`redirect_uris_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token_hash` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`member_id` integer NOT NULL,
	`scope` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_tokens_access_token_hash_unique` ON `mcp_oauth_tokens` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_tokens_refresh_token_hash_unique` ON `mcp_oauth_tokens` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_tokens_member_active_idx` ON `mcp_oauth_tokens` (`member_id`,`revoked_at`,`access_expires_at`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_tokens_client_created_idx` ON `mcp_oauth_tokens` (`client_id`,`created_at`);
