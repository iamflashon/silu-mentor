const ISSUE_PRACTICE_SUBJECT_PATTERNS = [
  /刑法/u,
  /民法/u,
  /行政法/u,
  /憲法/u,
  /(?:民事訴訟法|民訴)/u,
  /(?:刑事訴訟法|刑訴)/u,
  /(?:商事法|商法|公司法|證券交易法|證交法|保險法|票據法)/u,
  /(?:強制執行法|強執)/u,
];

export function supportsIssuePractice(subject: string | null | undefined) {
  const normalized = String(subject ?? "").replace(/\s+/gu, "").trim();
  return normalized.length > 0 && ISSUE_PRACTICE_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}
