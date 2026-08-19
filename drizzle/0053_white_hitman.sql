ALTER TABLE `documents` ADD `book_title` text DEFAULT '' NOT NULL;
UPDATE `documents` SET `book_title` = '醫檢師國考題詳解（Ⅲ）臨床病毒學（下）' WHERE `exam_category` = 'medtech' AND (`book_title` = '' OR `book_title` IS NULL);
UPDATE `exam_questions`
SET `answer_source` = (SELECT `book_title` FROM `documents` WHERE `documents`.`id` = CAST(substr(`exam_questions`.`source_url`, 10) AS INTEGER))
WHERE `exam_category` = 'medtech'
  AND `source_url` LIKE 'document:%'
  AND `answer_source` IN ('', '教材原稿', '手動新增／原稿答案')
  AND EXISTS (SELECT 1 FROM `documents` WHERE `documents`.`id` = CAST(substr(`exam_questions`.`source_url`, 10) AS INTEGER) AND `documents`.`book_title` <> '');
