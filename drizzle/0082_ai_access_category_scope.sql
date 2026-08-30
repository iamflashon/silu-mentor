ALTER TABLE `ai_access_entitlements` ADD `exam_category` text DEFAULT 'all' NOT NULL;
CREATE INDEX `ai_access_entitlements_member_category_expiry_idx` ON `ai_access_entitlements` (`member_id`,`exam_category`,`expires_at`);
