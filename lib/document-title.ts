export function normalizeDocumentTitle(value: string) {
  return value
    .replace(/\.(?:pdf|jsonl|md|txt|docx|zip)$/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

export function documentTitleFromFileName(fileName: string) {
  return normalizeDocumentTitle(fileName.replace(/\.[^.]+$/u, "").replace(/[._-]+/gu, " "));
}

export function documentDisplayTitle(bookTitle: string | null | undefined, fileName: string) {
  return normalizeDocumentTitle(bookTitle ?? "") || documentTitleFromFileName(fileName) || "未命名教材";
}

function extractedPreview(processingResultJson: string | null | undefined) {
  try {
    const parsed = JSON.parse(processingResultJson || "{}") as { extractedPreview?: unknown; facts?: { extractedPreview?: unknown } };
    const value = parsed.extractedPreview ?? parsed.facts?.extractedPreview;
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}

function looksLikeOpaqueFileTitle(value: string) {
  return /^(?:\d{8,}(?:[ _-]?\d+)?|[a-f0-9-]{16,})$/iu.test(normalizeDocumentTitle(value).replace(/\s+/gu, ""));
}

export function inferredDocumentTitle(processingResultJson: string | null | undefined) {
  const lines = extractedPreview(processingResultJson)
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const boilerplate = /^(?:本月企劃|摘要|關鍵詞|目次|目錄|第\s*\d+\s*頁|\d+)$/u;
  const index = lines.findIndex((line) => line.length >= 4 && line.length <= 70 && !boilerplate.test(line) && !/^本月企劃[:：]/u.test(line) && !/月旦法學雜誌/u.test(line));
  if (index < 0) return "";
  const title = lines[index].replace(/[＊*]+$/u, "").trim();
  const subtitle = lines[index + 1]?.match(/^[—─－-]{1,3}\s*(.{3,80})$/u)?.[1]?.trim();
  return normalizeDocumentTitle(subtitle ? `${title}——${subtitle}` : title);
}

export function documentDisplayTitleFromMetadata(input: { bookTitle?: string | null; fileName: string; processingResultJson?: string | null }) {
  const explicit = normalizeDocumentTitle(input.bookTitle ?? "");
  if (explicit && !looksLikeOpaqueFileTitle(explicit)) return explicit;
  const inferred = inferredDocumentTitle(input.processingResultJson);
  if (inferred) return inferred;
  const fileTitle = documentTitleFromFileName(input.fileName);
  return looksLikeOpaqueFileTitle(fileTitle) ? "未命名教材（請由後台補填名稱）" : fileTitle || "未命名教材";
}
