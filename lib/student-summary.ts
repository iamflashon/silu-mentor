export const STUDENT_SUMMARY_MAX_BYTES = 25 * 1024 * 1024;

export const STUDENT_SUMMARY_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
  ".jsonl",
] as const;

export function studentSummaryOwnerKey(request: Request) {
  const user = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
  return Array.from(user)
    .map((character) => character.charCodeAt(0).toString(16))
    .join("")
    .slice(0, 160) || "default-owner";
}

export function studentSummaryStoragePrefix(request: Request) {
  return `student-summaries/${studentSummaryOwnerKey(request)}/`;
}

export function summaryContentType(fileName: string, contentType = "") {
  const lower = fileName.toLocaleLowerCase("en-US");
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jsonl")) return "application/jsonl";
  if (lower.endsWith(".txt")) return "text/plain";
  return contentType || "application/octet-stream";
}

export function isSupportedStudentSummaryFile(fileName: string, contentType = "") {
  const lower = fileName.toLocaleLowerCase("en-US");
  return STUDENT_SUMMARY_EXTENSIONS.some((extension) => lower.endsWith(extension))
    || /application\/pdf|image\/(?:png|jpeg|webp)|text\/plain|application\/jsonl/i.test(contentType);
}

export function safeStudentSummaryName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "學習資料";
}
