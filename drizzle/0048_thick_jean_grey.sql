ALTER TABLE `exam_questions` ADD `complete_explanation` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `exam_questions`
SET `complete_explanation` = `explanation`, `explanation` = ''
WHERE `exam_category` = 'medtech'
  AND `answer_status` = 'ai_generated'
  AND `complete_explanation` = ''
  AND length(trim(`explanation`)) > 0;
