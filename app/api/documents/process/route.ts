import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents } from "../../../../db/schema";
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

async function uploadToVectorStore(document: typeof documents.$inferSelect, object: { arrayBuffer(): Promise<ArrayBuffer> }) {
  const originalBytes = await object.arrayBuffer();
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
    body: JSON.stringify({ file_id: filePayload.id, attributes: { subject: document.subject, document_type: document.documentType, source_file: document.fileName, indexed_file: source.fileName } }),
  });
  return { fileId: filePayload.id, storeId, status: typeof indexed.status === "string" ? indexed.status : "in_progress", indexedFileName: source.fileName };
}

async function analyzeIndexedDocument(document: typeof documents.$inferSelect, storeId: string, facts: Record<string, unknown>) {
  const model = await getOpenAIModel("gpt-5.6-luna");
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: "你是台灣司律教材資料編輯。必須使用 file_search 讀取指定原檔，只整理檔案中明確存在的章節、題目與分類，不得依一般法律知識補造。無法確認的欄位請留空或不列出。題目只在檔案明確有題號、題型或考題標記時列出；章節只列出原文可確認的篇、章、節或主題。",
      input: `請處理教材「${document.fileName}」。科目：${document.subject}；文件類型：${document.documentType}。本機已完成的技術檢查與結構線索如下，僅供核對，不得取代原檔搜尋：${JSON.stringify(facts)}`,
      tools: [{ type: "file_search", vector_store_ids: [storeId], max_num_results: 24 }],
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
    }),
  });
  return { model, analysis: parseAnalysis(payload) };
}

export async function POST(request: Request) {
  let documentId = 0;
  try {
    const body = await request.json() as { documentId?: number; retry?: boolean };
    documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "文件編號不正確" }, { status: 400 });
    const db = await getDb();
    let [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份文件" }, { status: 404 });
    if (document.status === "completed" && document.processingStage === "completed") return Response.json({ status: "completed", document });
    if (body.retry && document.status === "failed") {
      await db.update(documents).set({ status: "uploaded", processingStage: "queued", processingMessage: "已重新排入自動處理", indexError: null }).where(eq(documents.id, documentId));
      [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    }
    if (!document) throw new Error("找不到這份文件");

    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) throw new Error("找不到已上傳的原始檔案");

    if (["queued", "uploaded", "extracting"].includes(document.processingStage) || !document.fileSha256) {
      await db.update(documents).set({ status: "extracting", processingStage: "extracting", processingMessage: "正在檢查檔案、擷取文字與辨識結構", indexError: null }).where(eq(documents.id, documentId));
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("檔案大小不符合限制（最多 55MB）");
      if (!isSupportedDocument(document.fileName, document.contentType)) throw new Error("僅支援 PDF、JSONL、TXT 文件");
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
      const indexed = await uploadToVectorStore(document, object);
      await db.update(documents).set({ status: indexed.status, processingStage: "indexing", processingMessage: "全文檔案已送入索引，等待向量建立", openaiFileId: indexed.fileId, indexError: null, processingResultJson: JSON.stringify({ ...readProcessingResult(document.processingResultJson), indexedFileName: indexed.indexedFileName }) }).where(eq(documents.id, documentId));
      return Response.json({ status: "indexing", stage: "indexing", message: "全文／向量索引建立中" }, { status: 202 });
    }

    const storeId = await vectorStoreId();
    if (document.processingStage === "indexing" || !document.vectorIndexed) {
      const indexed = await openAIJson(`/vector_stores/${storeId}/files/${document.openaiFileId}`);
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
    const ai = await analyzeIndexedDocument(document, storeId, facts);
    const analysis = ai.analysis ?? {};
    const chapters = Array.isArray(analysis.chapters) ? analysis.chapters.filter((item) => String(item?.title ?? "").trim()).slice(0, 120) : [];
    const questions = Array.isArray(analysis.questions) ? analysis.questions.filter((item) => String(item?.title ?? item?.number ?? "").trim()).slice(0, 240) : [];
    const localTags = Array.isArray(facts.inferredTags) ? facts.inferredTags.map(String) : [];
    const aiTags = Array.isArray(analysis.tags) ? analysis.tags.map(String) : [];
    const result = { ...readProcessingResult(document.processingResultJson || "{}"), analysisStatus: ai.analysis ? "completed" : "indexed_without_confirmed_structure", model: ai.model, summary: String(analysis.summary ?? ""), chapters, questions };
    await db.update(documents).set({ status: "completed", processingStage: "completed", processingMessage: ai.analysis ? "教材已完成檢查、擷取、分類、全文／向量索引與 AI 結構分析" : "教材已完成全文／向量索引；AI 未確認可保存的章節或題目，未自行補造", chapterCount: chapters.length || Number((facts.chapterCandidates as unknown[])?.length ?? 0), questionCount: questions.length || Number((facts.questionCandidates as unknown[])?.length ?? 0), tagsJson: JSON.stringify(unique([document.subject, document.documentType, ...localTags, ...aiTags])), processingResultJson: JSON.stringify(result), processedAt: new Date(), indexError: null, fullTextIndexed: true, vectorIndexed: true }).where(eq(documents.id, documentId));
    return Response.json({ status: "completed", stage: "completed", message: "教材自動處理完成" });
  } catch (error) {
    const message = processingError(error);
    if (documentId) {
      try { const db = await getDb(); await db.update(documents).set({ status: "failed", processingStage: "failed", processingMessage: message, indexError: message }).where(eq(documents.id, documentId)); } catch { /* preserve original error */ }
    }
    return Response.json({ status: "failed", stage: "failed", error: message }, { status: 500 });
  }
}
