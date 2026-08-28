-- Copy the already verified physical PDF boundaries into every Cloudflare D1.
-- Only the private page-by-page index receives these mappings.
INSERT INTO document_section_mappings
  (document_id, section_key, title, section_type, sort_order, pdf_start_page, pdf_end_page, verified, updated_at)
SELECT d.id, m.section_key, m.title, m.section_type, m.sort_order, m.pdf_start_page, m.pdf_end_page, 1, unixepoch('now') * 1000
FROM documents d
CROSS JOIN (
  SELECT 'front_matter' section_key, '封面、序言與目錄（不供 AI 回答）' title, 'front_matter' section_type, 0 sort_order, 1 pdf_start_page, 22 pdf_end_page
  UNION ALL SELECT 'theme_1', '行政法理論基礎與行政組織法', 'body', 1, 23, 84
  UNION ALL SELECT 'theme_2', '行政處分', 'body', 2, 85, 172
  UNION ALL SELECT 'theme_3', '行政契約與行政命令', 'body', 3, 173, 233
  UNION ALL SELECT 'theme_4', '行政罰法', 'body', 4, 234, 302
  UNION ALL SELECT 'theme_5', '行政執行法', 'body', 5, 303, 332
  UNION ALL SELECT 'theme_6', '訴願法與行政訴訟法', 'body', 6, 333, 420
  UNION ALL SELECT 'theme_7', '國家賠償法與損失補償', 'body', 7, 421, 456
  UNION ALL SELECT 'theme_8', '新進實務見解整理', 'body', 8, 457, 495
) m
WHERE d.file_name LIKE '%.local-index.jsonl'
  AND (d.file_name LIKE '%59ML170502%' OR d.book_title LIKE '%行政法考點%')
ON CONFLICT(document_id, section_key) DO UPDATE SET
  title = excluded.title,
  section_type = excluded.section_type,
  sort_order = excluded.sort_order,
  pdf_start_page = excluded.pdf_start_page,
  pdf_end_page = excluded.pdf_end_page,
  verified = excluded.verified,
  updated_at = excluded.updated_at;
