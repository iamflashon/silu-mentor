import { unzipSync } from "fflate";

export const SUPPORTED_DOCUMENT_EXTENSIONS = [".pdf", ".html", ".htm", ".json", ".jsonl", ".md", ".txt", ".docx", ".zip"] as const;
export const MAX_DOCUMENT_BYTES = 55 * 1024 * 1024;
const LARGE_HTML_BYTES = 8 * 1024 * 1024;
const LARGE_HTML_SCAN_BYTES = 2 * 1024 * 1024;

export type DocumentExtension = "pdf" | "html" | "json" | "jsonl" | "md" | "txt" | "docx" | "zip";

export type ResolvedDocumentPayload = {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
  containerFileName?: string;
};

export type ExtractedDocumentFacts = {
  extension: "pdf" | "html" | "json" | "jsonl" | "md" | "txt" | "docx";
  container?: "zip";
  sourceFileName?: string;
  extractionMode: "structured_text" | "plain_text" | "pdf_index_service";
  pageCount?: number;
  textChars: number;
  recordCount: number;
  chapterCandidates: string[];
  questionCandidates: Array<{ number: string; title: string; chapter: string }>;
  docxQuestionRows?: number;
  inferredTags: string[];
  metadata: { title: string; source: string; category: string; date: string; version: string; parentPath: string; enabled: boolean };
  validation: { valid: boolean; checks: string[]; warnings: string[] };
};

export function documentExtension(fileName: string): DocumentExtension | null {
  const lower = fileName.toLocaleLowerCase("en-US");
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

export function isSupportedDocument(fileName: string, contentType = "") {
  return Boolean(documentExtension(fileName)) || /application\/(pdf|json|jsonl|zip)|text\/(plain|html)/i.test(contentType);
}

export function contentTypeForDocument(fileName: string, contentType = "") {
  const extension = documentExtension(fileName);
  if (extension === "pdf") return "application/pdf";
  if (extension === "html") return "text/html";
  if (extension === "json") return "application/json";
  if (extension === "jsonl") return "application/jsonl";
  if (extension === "md") return "text/markdown";
  if (extension === "txt") return "text/plain";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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
  // The platform accepts JSONL for structured ingestion, while OpenAI's file
  // index currently accepts JSON or plain text but rejects the .jsonl suffix.
  // Keep every JSONL record byte-for-byte and only present a supported suffix
  // to the downstream index service.
  if (extension === "jsonl") {
    return { fileName: fileName.replace(/\.jsonl$/iu, ".txt"), contentType: "text/plain", bytes };
  }
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
    .filter((entry): entry is { name: string; value: Uint8Array; extension: "pdf" | "html" | "json" | "jsonl" | "md" | "txt" | "docx" } =>
      entry.extension === "pdf" || entry.extension === "html" || entry.extension === "json" || entry.extension === "jsonl" || entry.extension === "md" || entry.extension === "txt" || entry.extension === "docx",
    )
    .sort((left, right) => {
      const priority = { pdf: 0, html: 1, json: 2, jsonl: 3, md: 4, docx: 5, txt: 6 } as const;
      return priority[left.extension] - priority[right.extension] || right.value.byteLength - left.value.byteLength;
    });
  const selected = candidates[0];
  if (!selected) throw new Error("ZIP 內找不到可處理的 PDF、HTML、JSON、JSONL、MD、TXT 或 DOCX 文件");
  const docxEntries = candidates
    .filter((entry) => entry.extension === "docx")
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hant", { numeric: true }));
  if (docxEntries.length > 1) {
    const combinedText = docxEntries.map((entry) => {
      const innerName = entry.name.split(/[\\/]/).filter(Boolean).at(-1) ?? entry.name;
      return `\n\n===== ${innerName} =====\n\n${extractDocxText(toArrayBuffer(entry.value))}`;
    }).join("");
    return {
      fileName: `${fileName.replace(/\.zip$/i, "")}-完整合併.txt`,
      contentType: "text/plain",
      bytes: new TextEncoder().encode(combinedText).buffer as ArrayBuffer,
      containerFileName: fileName,
    };
  }
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

function metadataFromRecord(record: Record<string, unknown>, fallbackTitle = "") {
  const enabledValue = record.enabled ?? record.is_enabled ?? record.active;
  return {
    title: first(record, ["document_title", "book_title", "title", "name"]) || fallbackTitle,
    source: first(record, ["source", "publisher", "author", "origin"]),
    category: first(record, ["category", "subject", "document_type", "type"]),
    date: first(record, ["date", "published_at", "publication_date", "updated_at"]),
    version: first(record, ["version", "edition", "revision"]),
    parentPath: first(record, ["parent_path", "section_path", "chapter", "folder"]),
    enabled: enabledValue === undefined ? true : ![false, 0, "0", "false", "disabled"].includes(enabledValue as never),
  };
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
  const metadata = metadataFromRecord(records[0] ?? {});
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
    metadata,
    validation: { valid: records.length > 0 && warnings.length === 0, checks: [`JSONL ${records.length} 筆`], warnings: warnings.slice(0, 12) },
  };
}

function factsFromJson(text: string): ExtractedDocumentFacts {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("JSON 格式無法解析，請確認逗號、括號與引號是否完整"); }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (!records.length || records.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("JSON 必須是物件或物件陣列");
  }
  const facts = factsFromJsonl(records.map((item) => JSON.stringify(item)).join("\n"));
  return { ...facts, extension: "json", validation: { ...facts.validation, checks: [`JSON ${records.length} 筆`] } };
}

function factsFromText(text: string, extension: "txt" | "md" | "docx" | "html" = "txt"): ExtractedDocumentFacts {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chapters = lines.filter((line) => /^(?:#{1,6}\s+|第\s*[一二三四五六七八九十百0-9]+\s*(?:編|篇|章|節)|[一二三四五六七八九十百]+、|\d+(?:\.\d+){0,3}\s+\S+)/.test(line));
  const questions: Array<{ number: string; title: string; chapter: string }> = [];
  for (const line of lines) {
    const match = line.match(/^(?:第\s*)?([0-9一二三四五六七八九十百]+)\s*(?:題|、|\.)\s*(.*)$/);
    if (match) questions.push({ number: match[1], title: match[2].slice(0, 180), chapter: chapters.at(-1) ?? "" });
  }
  return {
    extension,
    extractionMode: extension === "md" || extension === "html" ? "structured_text" : "plain_text",
    textChars: text.length,
    recordCount: 1,
    chapterCandidates: unique(chapters, 120),
    questionCandidates: questions.slice(0, 240),
    inferredTags: tagsFromText(text),
    metadata: { title: (lines.find((line) => /^#\s+/.test(line)) ?? lines[0] ?? "").replace(/^#+\s*/, ""), source: "", category: "", date: "", version: "", parentPath: "", enabled: true },
    validation: { valid: text.trim().length > 0, checks: [`${extension.toUpperCase()} 文字已擷取`], warnings: [] },
  };
}

function extractHtmlText(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*(script|style|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|section|article|blockquote|table)\s*>/gi, "\n")
    .replace(/<\s*(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\r?\n\s*\r?\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractDocxText(bytes: ArrayBuffer) {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(bytes)); } catch { throw new Error("DOCX 檔案無法解壓，請確認檔案沒有損壞"); }
  const xml = entries["word/document.xml"];
  if (!xml) throw new Error("DOCX 內找不到文件正文");
  return new TextDecoder().decode(xml)
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function countDocxAnswerRows(bytes: ArrayBuffer) {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(bytes)); } catch { return 0; }
  const xml = entries["word/document.xml"];
  if (!xml) return 0;
  const source = new TextDecoder().decode(xml);
  let count = 0;
  for (const row of source.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
    if (cells.length !== 2) continue;
    const answer = [...cells[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join("").replace(/&amp;/g,"&").trim();
    if (/^[（(]?\s*[A-Da-d]\s*[）)]?\.?$/u.test(answer)) count += 1;
  }
  // Some accounting quizzes put the entire paper in one large table row rather
  // than one question per row.  In that layout each top-level question is
  // followed by its own 【解答】 block, so the answer-block count is the reliable
  // boundary while the right-column count remains reliable for MCQ papers.
  const plainText = extractDocxText(bytes);
  const answerBlocks = (plainText.match(/【\s*(?:解答|解析)\s*】/gu) ?? []).length;
  return Math.max(count, answerBlocks);
}

export async function inspectDocumentBytes(fileName: string, bytes: ArrayBuffer): Promise<{ facts: ExtractedDocumentFacts; text: string; sha256: string }> {
  const originalExtension = documentExtension(fileName);
  if (!originalExtension) throw new Error("僅支援 PDF、HTML、JSON、JSONL、MD、TXT、DOCX 或 ZIP 文件");
  const payload = resolveDocumentPayload(fileName, contentTypeForDocument(fileName), bytes);
  const extension = documentExtension(payload.fileName);
  if (!extension || extension === "zip") throw new Error("ZIP 內找不到可處理的 PDF、HTML、JSON、JSONL、MD、TXT 或 DOCX 文件");
  const view = new Uint8Array(payload.bytes);
  const latin1 = new TextDecoder("latin1").decode(view.subarray(0, Math.min(view.length, 4_000_000)));
  const digestPromise = crypto.subtle.digest("SHA-256", bytes);
  const toHex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
  if (extension === "pdf") {
    if (!latin1.startsWith("%PDF-")) throw new Error("檔案副檔名是 PDF，但檔案標頭無效");
    const estimatedPages = Math.max(0, (latin1.match(/\/Type\s*\/Page\b/g) ?? []).length);
    let extractedText = "";
    let pages = estimatedPages;
    const extractionWarnings: string[] = [];
    try {
      const { extractText } = await import("unpdf");
      const extracted = await extractText(new Uint8Array(payload.bytes), { mergePages: true });
      extractedText = typeof extracted.text === "string" ? extracted.text : extracted.text.join("\n\f\n");
      pages = extracted.totalPages || estimatedPages;
    } catch {
      extractionWarnings.push("PDF 本地文字擷取未完成，將由索引服務接續辨識");
    }
    const localFacts = extractedText ? factsFromText(extractedText, "txt") : null;
    const facts: ExtractedDocumentFacts = {
      extension,
      ...(originalExtension === "zip" ? { container: "zip" as const, sourceFileName: payload.fileName } : {}),
      extractionMode: "pdf_index_service",
      textChars: extractedText.length,
      recordCount: 0,
      chapterCandidates: localFacts?.chapterCandidates ?? [],
      questionCandidates: localFacts?.questionCandidates ?? [],
      inferredTags: unique([...tagsFromText(fileName), ...(localFacts?.inferredTags ?? [])]),
      metadata: { title: fileName.replace(/\.pdf$/i, ""), source: "", category: "", date: "", version: "", parentPath: "", enabled: true },
      validation: { valid: true, checks: [originalExtension === "zip" ? `ZIP 內 PDF：${payload.fileName}` : "PDF 標頭有效", pages ? `偵測到 ${pages} 頁` : "頁數待索引服務確認", extractedText ? `已擷取 ${extractedText.length.toLocaleString()} 字` : "文字交由索引服務辨識"], warnings: extractionWarnings },
    };
    return { facts: { ...facts, pageCount: pages }, text: extractedText, sha256: toHex(await digestPromise) };
  }
  const largeHtml = extension === "html" && view.byteLength > LARGE_HTML_BYTES;
  const htmlView = largeHtml ? view.subarray(0, LARGE_HTML_SCAN_BYTES) : view;
  const text = extension === "docx"
    ? extractDocxText(payload.bytes)
    : extension === "html"
      ? extractHtmlText(new TextDecoder("utf-8", { fatal: false }).decode(htmlView).replace(/^\uFEFF/, ""))
    : new TextDecoder("utf-8", { fatal: false }).decode(view).replace(/^\uFEFF/, "");
  const facts = extension === "json" ? factsFromJson(text) : extension === "jsonl" ? factsFromJsonl(text) : factsFromText(text, extension);
  if (largeHtml) facts.validation.warnings.push("HTML 原稿超過 8MB，已快速擷取前段結構線索；完整原稿仍會保留並交由全文索引服務處理");
  if (extension === "docx") facts.docxQuestionRows = countDocxAnswerRows(payload.bytes);
  return {
    facts: originalExtension === "zip"
      ? { ...facts, container: "zip", sourceFileName: payload.fileName }
      : facts,
    text,
    sha256: toHex(await digestPromise),
  };
}
