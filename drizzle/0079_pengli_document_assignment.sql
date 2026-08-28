INSERT INTO `document_assignments` (`document_id`, `exam_category`, `subject`, `usage_type`, `visibility`, `ai_search_enabled`, `sort_order`, `created_at`, `updated_at`)
SELECT `id`, 'pengli', '行政法', '教材檢索', 'members', 1, 0, unixepoch(), unixepoch()
FROM `documents`
WHERE (`file_name` LIKE '%59ML170502%' OR `book_title` LIKE '%行政法考點%')
  AND NOT EXISTS (
    SELECT 1
    FROM `document_assignments`
    WHERE `document_assignments`.`document_id` = `documents`.`id`
      AND `document_assignments`.`exam_category` = 'pengli'
  );
