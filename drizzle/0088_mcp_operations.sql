CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`endpoint_url` text NOT NULL,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`secret_env_key` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`allowed_roles_json` text DEFAULT '["student","teacher","admin"]' NOT NULL,
	`monthly_budget_usd_micros` integer DEFAULT 0 NOT NULL,
	`default_credit_cost` integer DEFAULT 1 NOT NULL,
	`default_call_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`timeout_ms` integer DEFAULT 15000 NOT NULL,
	`last_health_status` text DEFAULT 'untested' NOT NULL,
	`last_health_message` text DEFAULT '尚未測試' NOT NULL,
	`last_health_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_endpoint_url_unique` ON `mcp_servers` (`endpoint_url`);
--> statement-breakpoint
CREATE INDEX `mcp_servers_status_updated_idx` ON `mcp_servers` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `mcp_tool_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`require_approval` integer DEFAULT false NOT NULL,
	`allowed_roles_json` text DEFAULT '["student","teacher","admin"]' NOT NULL,
	`credit_cost` integer DEFAULT 1 NOT NULL,
	`call_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_policies_server_tool_unique` ON `mcp_tool_policies` (`server_id`,`tool_name`);
--> statement-breakpoint
CREATE INDEX `mcp_tool_policies_server_enabled_idx` ON `mcp_tool_policies` (`server_id`,`enabled`);
--> statement-breakpoint
CREATE TABLE `platform_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` integer,
	`user_key` text DEFAULT 'anonymous' NOT NULL,
	`category` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`resource` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`request_key` text DEFAULT '' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`call_count` integer DEFAULT 1 NOT NULL,
	`credit_delta` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `platform_usage_events_created_idx` ON `platform_usage_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `platform_usage_events_user_created_idx` ON `platform_usage_events` (`user_key`,`created_at`);
--> statement-breakpoint
CREATE INDEX `platform_usage_events_category_resource_idx` ON `platform_usage_events` (`category`,`resource`);
--> statement-breakpoint
PRAGMA optimize;
