import { unzipSync } from "fflate";

export const SUPPORTED_DOCUMENT_EXTENSIONS = [".pdf", ".jsonl", ".txt", ".zip"] as const;
export const MAX_DOCUMENT_BYTES = 55 * 1024 * 1024;

export type DocumentExtension = "pdf" | "jsonl" | "txt" | "zip";

export type ResolvedDocumentPayload = {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
  containerFileName?: string;
};

export type ExtractedDocumentFacts = {
  extension: "pdf" | "jsonl" | "txt";
  container?: "zip";
  sourceFileName?: string;
  extractionMode: "structured_text" | "plain_text" | "pdf_index_service";
  pageCount?: number;
  textChars: number;
  recordCount: number;
  chapterCandidates: string[];
  questionCandidates: Array<{ number: string; title: string; chapter: string }>;
  inferredTags: string[];
  validation: { valid: boolean; checks: string[]; warnings: string[] };
};

export function documentExtension(fileName: string): DocumentExtension | null {
  const lower = fileName.toLocaleLowerCase("en-US");
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

export function isSupportedDocument(fileName: string, contentType = "") {
  return Boolean(documentExtension(fileName)) || /application\/(pdf|json|jsonl|zip)|text\/plain/i.test(contentType);
}

export function contentTypeForDocument(fileName: string, contentType = "") {
  const extension = documentExtension(fileName);
  if (extension === "pdf") return "application/pdf";
  if (extension === "jsonl") return "application/jsonl";
  if (extension === "txt") return "text/plain";
  if (extension === "zip") return "application/zip";
  return contentType || "application/octet-stream";
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * ZIP is accepted as a convenience for教材套件, but the index service receives
 * the actual supported document inside it. Only one level is unpacked and the
 * first PDF is preferred over JSONL/TXT so a book archive cannot be indexed as
 * an opaque ZIP blob.
 */
export function resolveDocumentPayload(fileName: string, contentType: string, bytes: ArrayBuffer): ResolvedDocumentPayload {
  const extension = documentExtension(fileName);
  if (extension !== "zip") {
    return { fileName, contentType: contentTypeForDocument(fileName, contentType), bytes };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("ZIP 檔案無法解壓，請確認壓縮檔沒有損壞");
  }
  const candidates = Object.entries(entries)
    .filter(([name, value]) => value.byteLength > 0 && !name.endsWith("/"))
    .map(([name, value]) => ({ name, value, extension: documentExtension(name) }))
    .filter((entry): entry is { name: string; value: Uint8Array; extension: "pdf" | "jsonl" | "txt" } =>
      entry.extension === "pdf" || entry.extension === "jsonl" || entry.extension === "txt",
    )
    .sort((left, right) => {
      const priority = { pdf: 0, jsonl: 1, txt: 2 } as const;
      return priority[left.extension] - priority[right.extension] || right.value.byteLength - left.value.byteLength;
    });
  const selected = candidates[0];
  if (!selected) throw new Error("ZIP 內找不到可處理的 PDF、JSONL 或 TXT 文件");
  const safeInnerName = selected.name.split(/[\\/]/).filter(Boolean).at(-1) ?? selected.name;
  return {
    fileName: safeInnerName,
    contentType: contentTypeForDocument(safeInnerName),
    bytes: toArrayBuffer(selected.value),
    containerFileName: fileName,
  };
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values: string[], limit = 24) {
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, limit);
}

function first(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return "";
}

function tagsFromText(text: string) {
  const tags: string[] = [];
  for (const match of text.matchAll(/(?:刑法|民法|憲法|行政法|刑事訴訟法|民事訴訟法|商法|公司法|國際私法|國際公法)/g)) tags.push(match[0]);
  for (const match of text.matchAll(/(?:司法官|律師|司律|一試|二試|選擇題|申論題|解題書|教科書|講義|歷屆試題)/g)) tags.push(match[0]);
  return unique(tags, 16);
}

function readJsonLines(text: string) {
  const records: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) records.push(value as Record<string, unknown>);
      else warnings.push(`第 ${index + 1} 行不是 JSON 物件`);
    } catch {
      warnings.push(`第 ${index + 1} 行 JSON 格式錯誤`);
    }
  }
  return { records, warnings };
}

function factsFromJsonl(text: string): ExtractedDocumentFacts {
  const { records, warnings } = readJsonLines(text);
  const chapters: string[] = [];
  const questions: Array<{ number: string; title: string; chapter: string }> = [];
  const tags = [...tagsFromText(text)];
  for (const record of records) {
    const section = first(record, ["section_path", "sectionPath", "part", "chapter", "chapter_title", "section", "topic"]);
    if (section) chapters.push(section);
    const questionNumber = first(record, ["question_no", "questionNo", "question_number", "questionNumber", "number"]);
    const title = first(record, ["question_title", "questionTitle", "question", "title", "topic"]);
    const contentType = first(record, ["content_type", "contentType", "type"]);
    if (questionNumber || /題|question|case|exam/i.test(contentType)) {
      questions.push({ number: questionNumber, title: title.slice(0, 180), chapter: section });
    }
    for (const key of ["subject", "exam", "category", "tags", "legal_topics", "legalTopics"]) {
      const value = record[key];
      if (Array.isArray(value)) tags.push(...value.map(clean));
      else if (value) tags.push(clean(value));
    }
  }
  return {
    extension: "jsonl",
    extractionMode: "structured_text",
    textChars: text.length,
    recordCount: records.length,
    chapterCandidates: unique(chapters, 120),
    questionCandidates: questions.slice(0, 240),
    inferredTags: unique(tags, 24),
    validation: { valid: records.length > 0 && warnings.length === 0, checks: [`JSONL ${records.length} 筆`], warnings: warnings.slice(0, 12) },
  };
}

function factsFromText(text: string): ExtractedDocumentFacts {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chapters = lines.filter((line) => /^(?:第\s*[一二三四五六七八九十百0-9]+\s*(?:編|篇|章|節)|[一二三四五六七八九十百]+、|\d+(?:\.\d+){0,3}\s+\S+)/.test(line));
  const questions: Array<{ number: string; title: string; chapter: string }> = [];
  for (const line of lines) {
    const match = line.match(/^(?:第\s*)?([0-9一二三四五六七八九十百]+)\s*(?:題|、|\.)\s*(.*)$/);
    if (match) questions.push({ number: match[1], title: match[2].slice(0, 180), chapter: chapters.at(-1) ?? "" });
  }
  return {
    extension: "txt",
    extractionMode: "plain_text",
    textChars: text.length,
    recordCount: 1,
    chapterCandidates: unique(chapters, 120),
    questionCandidates: questions.slice(0, 240),
    inferredTags: tagsFromText(text),
    validation: { valid: text.trim().length > 0, checks: ["TXT 文字已擷取"], warnings: [] },
  };
}

export async function inspectDocumentBytes(fileName: string, bytes: ArrayBuffer): Promise<{ facts: ExtractedDocumentFacts; text: string; sha256: string }> {
  const originalExtension = documentExtension(fileName);
  if (!originalExtension) throw new Error("僅支援 PDF、JSONL、TXT 或 ZIP 文件");
  const payload = resolveDocumentPayload(fileName, contentTypeForDocument(fileName), bytes);
  const extension = documentExtension(payload.fileName);
  if (!extension || extension === "zip") throw new Error("ZIP 內找不到可處理的 PDF、JSONL 或 TXT 文件");
  const view = new Uint8Array(payload.bytes);
  const latin1 = new TextDecoder("latin1").decode(view.subarray(0, Math.min(view.length, 4_000_000)));
  const digestPromise = crypto.subtle.digest("SHA-256", bytes);
  const toHex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
  if (extension === "pdf") {
    if (!latin1.startsWith("%PDF-")) throw new Error("檔案副檔名是 PDF，但檔案標頭無效");
    const pages = Math.max(0, (latin1.match(/\/Type\s*\/Page\b/g) ?? []).length);
    const facts: ExtractedDocumentFacts = {
      extension,
      ...(originalExtension === "zip" ? { container: "zip" as const, sourceFileName: payload.fileName } : {}),
      extractionMode: "pdf_index_service",
      textChars: 0,
      recordCount: 0,
      chapterCandidates: [],
      questionCandidates: [],
      inferredTags: tagsFromText(fileName),
      validation: { valid: true, checks: [originalExtension === "zip" ? `ZIP 內 PDF：${payload.fileName}` : "PDF 標頭有效", pages ? `偵測到約 ${pages} 頁` : "頁數待索引服務確認"], warnings: ["PDF 文字與章節將由索引服務及 AI 依原檔分析"] },
    };
    return { facts: { ...facts, pageCount: pages }, text: "", sha256: toHex(await digestPromise) };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(view).replace(/^\uFEFF/, "");
  const facts = extension === "jsonl" ? factsFromJsonl(text) : factsFromText(text);
  return {
    facts: originalExtension === "zip"
      ? { ...facts, container: "zip", sourceFileName: payload.fileName }
      : facts,
    text,
    sha256: toHex(await digestPromise),
  };
}
