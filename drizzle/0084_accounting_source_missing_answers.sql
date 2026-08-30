UPDATE `exam_questions`
SET `quality_acknowledgements_json` = CASE
  WHEN json_valid(`quality_acknowledgements_json`) THEN json_insert(
    `quality_acknowledgements_json`,
    '$[#]',
    json_object(
      'warning', 'missing-answer',
      'confirmedAt', '2026-08-30T15:36:00.000Z',
      'confirmedBy', 'batch:owner',
      'note', '原書未附答案'
    )
  )
  ELSE json_array(json_object(
    'warning', 'missing-answer',
    'confirmedAt', '2026-08-30T15:36:00.000Z',
    'confirmedBy', 'batch:owner',
    'note', '原書未附答案'
  ))
END
WHERE `exam_category` = 'accounting'
  AND `exam_type` NOT IN ('essay', 'short_answer', 'calculation')
  AND trim(coalesce(`teacher_answer`, '')) = ''
  AND trim(coalesce(`correct_answer`, '')) = ''
  AND trim(coalesce(json_extract(`options_json`, '$.A'), '')) <> ''
  AND trim(coalesce(json_extract(`options_json`, '$.B'), '')) <> ''
  AND trim(coalesce(json_extract(`options_json`, '$.C'), '')) <> ''
  AND trim(coalesce(json_extract(`options_json`, '$.D'), '')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(
      CASE
        WHEN json_valid(`quality_acknowledgements_json`) THEN `quality_acknowledgements_json`
        ELSE '[]'
      END
    )
    WHERE json_extract(json_each.value, '$.warning') = 'missing-answer'
  )
  AND `source_url` IN (
    SELECT 'document:' || cast(`id` AS text)
    FROM `documents`
    WHERE `exam_category` = 'accounting'
      AND (
        `file_name` LIKE '51MM320901%'
        OR `storage_key` LIKE '%51MM320901%'
      )
    UNION
    SELECT `storage_key`
    FROM `documents`
    WHERE `exam_category` = 'accounting'
      AND (
        `file_name` LIKE '51MM320901%'
        OR `storage_key` LIKE '%51MM320901%'
      )
    UNION
    SELECT `file_name`
    FROM `documents`
    WHERE `exam_category` = 'accounting'
      AND (
        `file_name` LIKE '51MM320901%'
        OR `storage_key` LIKE '%51MM320901%'
      )
  );
