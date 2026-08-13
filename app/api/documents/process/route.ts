import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, usageLogs } from "../../../../db/schema";
import { getOpenAIModel, openAIHeaders, openAIJson } from "../../../../lib/openai";
import { inspectDocumentBytes, MAX_DOCUMENT_BYTES, isSupportedDocument, resolveDocumentPayload } from "../../../../lib/document-processing";

type Analysis = {
  document_title?: string;
  content_type?: string;
  summary?: string;
  tags?: string[];
  chapters?: Array<{ title?: string; path?: string; page_start?: number | null; page_end?: number | null }>;
  questions?: Array<{ number?: string; title?: string; content_type?: string; chapter?: string }>;
};

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []);
  }).join("").trim();
}

function parseAnalysis(payload: Record<string, unknown>): Analysis | null {
  const raw = responseText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Analysis;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function unique(values: string[], limit = 32) {
  return [...new Set(values.map((value) => String(value).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, limit);
}

function processingError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "教材自動處理失敗";
}

function readProcessingResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function vectorStoreId() {
  const db = await getDb();
  const [saved] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
  if (saved?.value) return saved.value;
  const created = await openAIJson("/vector_stores", { method: "POST", body: JSON.stringify({ name: "司律備考教材知識庫" }) });
  const id = typeof created.id === "string" ? created.id : "";
  if (!id) throw new Error("無法建立教材全文／向量索引庫");
  await db.insert(appSettings).values({ key: "openai_vector_store_id", value: id, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: id, updatedAt: new Date() } });
  return id;
}

async function uploadToVectorStore(document: typeof documents.$inferSelect, originalBytes: ArrayBuffer) {
  const source = resolveDocumentPayload(document.fileName, document.contentType, originalBytes);
  const form = new FormData();
  form.set("purpose", "assistants");
  form.set("file", new File([source.bytes], source.fileName, { type: source.contentType }));
  const fileResponse = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: await openAIHeaders(false), body: form });
  const filePayload = await fileResponse.json() as { id?: string; error?: { message?: string } };
  if (!fileResponse.ok || !filePayload.id) throw new Error(filePayload.error?.message ?? "文件無法送入教材索引服務");
  const storeId = await vectorStoreId();
  const indexed = await openAIJson(`/vector_stores/${storeId}/files`, {
    method: "POST",
    body: JSON.stringify({ file_id: filePayload.id, attributes: { exam_category: document.examCategory, subject: document.subject, document_type: document.documentType, source_file: document.fileName, indexed_file: source.fileName, homepage_enabled: Boolean(document.homepageSearchEnabled) } }),
  });
  return { fileId: filePayload.id, storeId, status: typeof indexed.status === "string" ? indexed.status : "in_progress", indexedFileName: source.fileName };
}

async function analyzeIndexedDocument(document: typeof documents.$inferSelect, storeId: string, facts: Record<string, unknown>) {
  const model = await getOpenAIModel("gpt-5.6-luna");
  const isMedtech = document.examCategory === "medtech";
  const isAccounting = document.examCategory === "accounting";
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: isMedtech ? "你是台灣醫事檢驗師國考教材資料編輯。必須使用 file_search 讀取指定原檔，只整理檔案中明確存在的科目、章節、專有名詞、題目與分類，不得補造。" : isAccounting ? "你是台灣中級會計教材與題庫資料編輯。必須使用 file_search 廣泛讀取指定原檔，做完整題目盤點，不是摘要抽樣。逐章辨識所有明確存在的例題、範例、選擇題、練習題、計算題、分錄題、申論題及其子題；跨頁題幹合併為同一題，(1)(2)(3) 子題保留在同一題 title 內，不可各算一題。不同章的重複題號仍分別列出並標明 chapter。title 盡量保留完整題幹，不得只寫主題。content_type 標示選擇題、計算題、分錄題、申論題、例題或其他。只整理原檔內容，不得補造。題庫或年度解題以找齊全書題目為優先；核心教材同時盤點例題與章末練習。" : "你是台灣司律教材資料編輯。必須使用 file_search 讀取指定原檔，只整理檔案中明確存在的章節、題目與分類，不得補造。",
      input: `請完整處理教材「${document.fileName}」。科目：${document.subject}；文件類型：${document.documentType}。搜尋目錄、各章題號頁、例題、練習、選擇題、計算題、分錄題與申論題等不同關鍵詞，盡可能盤點全書，不要只回傳代表性題目。結構線索僅供核對：${JSON.stringify(facts)}`,
      tools: [{ type: "file_search", vector_store_ids: [storeId], max_num_results: isAccounting ? 50 : 24 }],
      text: {
        format: {
          type: "json_schema",
          name: "document_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              document_title: { type: "string" },
              content_type: { type: "string" },
              summary: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              chapters: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, path: { type: "string" }, page_start: { type: ["integer", "null"] }, page_end: { type: ["integer", "null"] } }, required: ["title", "path", "page_start", "page_end"] } },
              questions: { type: "array", items: { type: "object", additionalProperties: false, properties: { number: { type: "string" }, title: { type: "string" }, content_type: { type: "string" }, chapter: { type: "string" } }, required: ["number", "title", "content_type", "chapter"] } },
            },
            required: ["document_title", "content_type", "summary", "tags", "chapters", "questions"],
          },
        },
      },
      max_output_tokens: isAccounting ? 16000 : 6000,
    }),
  });
  const usage = payload.usage && typeof payload.usage === "object"
    ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
    : {};
  return { model, analysis: parseAnalysis(payload), usage };
}

function hasReliableLocalStructure(facts: Record<string, unknown>) {
  const extension = String(facts.extension ?? "");
  const chapters = Array.isArray(facts.chapterCandidates) ? facts.chapterCandidates.length : 0;
  const questions = Array.isArray(facts.questionCandidates) ? facts.questionCandidates.length : 0;
  const records = Number(facts.recordCount ?? 0);
  if (extension === "jsonl") return records > 0;
  if (extension === "md") return chapters > 0;
  return (extension === "txt" || extension === "docx") && (chapters >= 3 || questions >= 3);
}

function localAnalysis(document: typeof documents.$inferSelect, facts: Record<string, unknown>): Analysis {
  const metadata = facts.metadata && typeof facts.metadata === "object" ? facts.metadata as Record<string, unknown> : {};
  const chapters = (Array.isArray(facts.chapterCandidates) ? facts.chapterCandidates : []).map((title) => ({
    title: String(title).replace(/^#{1,6}\s*/, ""), path: String(title).replace(/^#{1,6}\s*/, ""), page_start: null, page_end: null,
  }));
  const questions = (Array.isArray(facts.questionCandidates) ? facts.questionCandidates : []).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { number: String(row.number ?? ""), title: String(row.title ?? ""), content_type: "題目", chapter: String(row.chapter ?? "") };
  });
  return {
    document_title: String(metadata.title ?? "") || document.fileName.replace(/\.[^.]+$/, ""),
    content_type: String(metadata.category ?? "") || document.documentType,
    summary: "文件結構完整，已依原始標題與欄位直接整理，未使用生成式 AI 改寫。",
    tags: Array.isArray(facts.inferredTags) ? facts.inferredTags.map(String) : [],
    chapters,
    questions,
  };
}

export async function POST(request: Request) {
  let documentId = 0;
  try {
    const body = await request.json() as { documentId?: number; retry?: boolean; reanalyze?: boolean };
    documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "文件編號不正確" }, { status: 400 });
    const db = await getDb();
    let [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份文件" }, { status: 404 });
    // Older records can say "completed" even though they predate the current
    // vector-index flags or no longer have a usable OpenAI file binding.  Only
    // short-circuit when the searchable index is actually complete.
    if (
      !body.retry && !body.reanalyze &&
      document.status === "completed" &&
      document.processingStage === "completed" &&
      document.openaiFileId &&
      document.fullTextIndexed &&
      document.vectorIndexed
    ) return Response.json({ status: "completed", document });
    if (body.retry) {
      await db.update(documents).set({ status: "uploaded", processingStage: "queued", processingMessage: "已由原始教材重新擷取全部檔案", indexError: null, fileSha256: null, openaiFileId: null, fullTextIndexed: false, vectorIndexed: false }).where(eq(documents.id, documentId));
      [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    }
    if (!document) throw new Error("找不到這份文件");

    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) throw new Error("找不到已上傳的原始檔案");
    // R2 bodies are single-use streams. Read exactly once in this request and
    // reuse the bytes for inspection and indexing.
    const originalBytes = await object.arrayBuffer();

    if (["queued", "uploaded", "extracting"].includes(document.processingStage) || !document.fileSha256) {
      await db.update(documents).set({ status: "extracting", processingStage: "extracting", processingMessage: "正在檢查檔案、擷取文字與辨識結構", indexError: null }).where(eq(documents.id, documentId));
      const bytes = originalBytes;
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("檔案大小不符合限制（最多 55MB）");
      if (!isSupportedDocument(document.fileName, document.contentType)) throw new Error("僅支援 PDF、JSON、JSONL、MD、TXT、DOCX 或 ZIP 文件");
      const inspected = await inspectDocumentBytes(document.fileName, bytes);
      const existingResult = {
        facts: inspected.facts,
        localTextExtracted: inspected.text.length > 0,
        extractedPreview: inspected.text.slice(0, 500),
        sourceFileName: document.fileName,
        indexedFileName: inspected.facts.sourceFileName ?? document.fileName,
        extractionNote: inspected.text.length > 0
          ? "已在上傳階段擷取本地文字"
          : "PDF 文字由全文／向量索引服務擷取，完成後由 AI 依索引內容整理章節與題目",
      };
      await db.update(documents).set({ status: "indexing", processingStage: "indexing", processingMessage: "檔案檢查完成，正在建立全文／向量索引", fileSha256: inspected.sha256, pageCount: inspected.facts.pageCount ?? null, extractedChars: inspected.facts.textChars, tagsJson: JSON.stringify(unique([document.subject, document.documentType, ...inspected.facts.inferredTags])), processingResultJson: JSON.stringify(existingResult), indexError: null }).where(eq(documents.id, documentId));
      [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    }
    if (!document) throw new Error("文件狀態更新失敗");

    if (!document.openaiFileId) {
      const indexed = await uploadToVectorStore(document, originalBytes);
      await db.update(documents).set({ status: indexed.status, processingStage: "indexing", processingMessage: "全文檔案已送入索引，等待向量建立", openaiFileId: indexed.fileId, indexError: null, processingResultJson: JSON.stringify({ ...readProcessingResult(document.processingResultJson), indexedFileName: indexed.indexedFileName }) }).where(eq(documents.id, documentId));
      return Response.json({ status: "indexing", stage: "indexing", message: "全文／向量索引建立中" }, { status: 202 });
    }

    const storeId = await vectorStoreId();
    if (document.processingStage === "indexing" || !document.vectorIndexed) {
      const indexed = await openAIJson(`/vector_stores/${storeId}/files/${document.openaiFileId}`).catch(() => null);
      if (!indexed) {
        // The database may still contain an ID created by the retired index.
        // Clear only that stale remote binding; the original R2 file remains
        // intact and will be uploaded to the current vector store next poll.
        await db.update(documents).set({
          status: "indexing",
          processingStage: "indexing",
          processingMessage: "舊索引已失效，正在由原始教材補建新版索引",
          openaiFileId: null,
          fullTextIndexed: false,
          vectorIndexed: false,
          indexError: null,
        }).where(eq(documents.id, documentId));
        return Response.json({ status: "indexing", stage: "indexing", message: "舊索引已失效，正在自動補建" }, { status: 202 });
      }
      const indexStatus = typeof indexed.status === "string" ? indexed.status : "in_progress";
      if (indexStatus !== "completed") {
        if (["failed", "cancelled"].includes(indexStatus)) throw new Error("全文／向量索引服務處理失敗，請按重新處理");
        await db.update(documents).set({ status: indexStatus, processingStage: "indexing", processingMessage: `全文／向量索引建立中（${indexStatus}）` }).where(eq(documents.id, documentId));
        return Response.json({ status: "indexing", stage: "indexing", message: `索引建立中：${indexStatus}` }, { status: 202 });
      }
      await db.update(documents).set({ status: "analyzing", processingStage: "analyzing", processingMessage: "全文／向量索引完成，AI 正在整理章節、題目與分類", fullTextIndexed: true, vectorIndexed: true, indexError: null }).where(eq(documents.id, documentId));
      [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    }
    if (!document) throw new Error("文件狀態更新失敗");

    let facts: Record<string, unknown> = {};
    try { facts = JSON.parse(document.processingResultJson).facts ?? {}; } catch { /* use AI only */ }
    const ruleOnly = hasReliableLocalStructure(facts);
    const ai = ruleOnly ? null : await analyzeIndexedDocument(document, storeId, facts);
    const analysis = ruleOnly ? localAnalysis(document, facts) : ai?.analysis ?? {};
    const chapters = Array.isArray(analysis.chapters) ? analysis.chapters.filter((item) => String(item?.title ?? "").trim()).slice(0, 120) : [];
    const questions = Array.isArray(analysis.questions) ? analysis.questions.filter((item) => String(item?.title ?? item?.number ?? "").trim()).slice(0, 240) : [];
    const localTags = Array.isArray(facts.inferredTags) ? facts.inferredTags.map(String) : [];
    const aiTags = Array.isArray(analysis.tags) ? analysis.tags.map(String) : [];
    const metadata = facts.metadata && typeof facts.metadata === "object" ? facts.metadata : {};
    const result = { ...readProcessingResult(document.processingResultJson || "{}"), analysisStatus: ruleOnly ? "rule_only" : ai?.analysis ? "completed" : "indexed_without_confirmed_structure", processingMode: ruleOnly ? "rules_and_index" : "rules_index_and_ai", model: ruleOnly ? "規則整理（0 生成 Token）" : ai?.model, metadata, summary: String(analysis.summary ?? ""), chapters, questions };
    if (ai) {
      await db.insert(usageLogs).values({
        model: ai.model,
        source: `智能書上架｜結構分析｜${document.fileName}`,
        inputTokens: ai.usage.input_tokens ?? 0,
        cachedTokens: ai.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: ai.usage.output_tokens ?? 0,
        fileSearchCalls: 1,
        estimatedCostUsdMicros: 2500,
      }).catch(() => undefined);
    }
    await db.update(documents).set({ status: "completed", processingStage: "completed", processingMessage: ruleOnly ? "教材結構完整，已用規則整理並完成全文／向量索引；未使用生成式 AI" : ai?.analysis ? "教材已完成檢查、擷取、分類、全文／向量索引與 AI 結構分析" : "教材已完成全文／向量索引；AI 未確認可保存的章節或題目，未自行補造", chapterCount: chapters.length || Number((facts.chapterCandidates as unknown[])?.length ?? 0), questionCount: questions.length || Number((facts.questionCandidates as unknown[])?.length ?? 0), tagsJson: JSON.stringify(unique([document.subject, document.documentType, ...localTags, ...aiTags])), processingResultJson: JSON.stringify(result), processedAt: new Date(), indexError: null, fullTextIndexed: true, vectorIndexed: true }).where(eq(documents.id, documentId));
    return Response.json({ status: "completed", stage: "completed", message: "教材自動處理完成" });
  } catch (error) {
    const message = processingError(error);
    if (documentId) {
      try { const db = await getDb(); await db.update(documents).set({ status: "failed", processingStage: "failed", processingMessage: message, indexError: message }).where(eq(documents.id, documentId)); } catch { /* preserve original error */ }
    }
    return Response.json({ status: "failed", stage: "failed", error: message }, { status: 500 });
  }
}
