CREATE TABLE IF NOT EXISTS `legal_data_sources` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_key` text NOT NULL,
  `label` text NOT NULL,
  `category` text NOT NULL,
  `source_url` text NOT NULL,
  `status` text DEFAULT 'waiting' NOT NULL,
  `document_count` integer DEFAULT 0 NOT NULL,
  `article_count` integer DEFAULT 0 NOT NULL,
  `import_cursor` integer DEFAULT 0 NOT NULL,
  `total_available` integer DEFAULT 0 NOT NULL,
  `archive_storage_key` text,
  `last_error` text,
  `last_downloaded_at` integer,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `legal_data_sources_source_key_unique`
  ON `legal_data_sources` (`source_key`);
