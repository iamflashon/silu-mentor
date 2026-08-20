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
