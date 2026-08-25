CREATE TABLE `accounting_products` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `product_key` text NOT NULL,
  `title` text NOT NULL,
  `subtitle` text DEFAULT '' NOT NULL,
  `description_html` text DEFAULT '' NOT NULL,
  `list_price` integer DEFAULT 249 NOT NULL,
  `sale_price` integer,
  `sale_label` text DEFAULT '' NOT NULL,
  `sale_starts_at` integer,
  `sale_ends_at` integer,
  `access_days` integer DEFAULT 90 NOT NULL,
  `trial_questions` integer DEFAULT 10 NOT NULL,
  `renewal_mode` text DEFAULT 'extend' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `sort_order` integer DEFAULT 10 NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX `accounting_products_product_key_unique` ON `accounting_products` (`product_key`);
CREATE TABLE `accounting_member_entitlements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `member_id` integer NOT NULL,
  `product_key` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `starts_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `updated_by` text DEFAULT '' NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `accounting_member_entitlements_member_product_unique` ON `accounting_member_entitlements` (`member_id`,`product_key`);
CREATE INDEX `accounting_member_entitlements_product_expiry_idx` ON `accounting_member_entitlements` (`product_key`,`expires_at`);
INSERT INTO `accounting_products` (`product_key`,`title`,`subtitle`,`description_html`,`list_price`,`access_days`,`trial_questions`,`renewal_mode`,`status`,`sort_order`)
VALUES ('accounting-grad-school-question-bank','會研所中級會計學題庫制霸','依章節、學校與年度練習研究所中級會計選擇題','<p>收錄會研所中級會計選擇題、完整計算過程與老師解析。可依章節練習、錯題重練及限時模擬。</p>',249,90,10,'extend','draft',10);
