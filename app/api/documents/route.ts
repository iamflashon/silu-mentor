import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, documents } from "../../../db/schema";
import { appSettings } from "../../../db/schema";
import { contentTypeForDocument, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../lib/document-processing";
import { storedDocumentAnalysis, storedDocumentStats } from "../../../lib/document-analysis";

function processingResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(documents).orderBy(desc(documents.createdAt)).limit(50);
    const [documentStats] = await db.select({
      total: sql<number>`count(*)`,
      ready: sql<number>`coalesce(sum(case when ${documents.status} = 'completed' then 1 else 0 end), 0)`,
      indexedBytes: sql<number>`coalesce(sum(case when ${documents.status} = 'completed' then ${documents.sizeBytes} else 0 end), 0)`,
    }).from(documents);
    const [usageStats] = await db.select({
      citations: sql<number>`coalesce(sum(case when ${chatMessages.source} = '教材' then 1 else 0 end), 0)`,
      misses: sql<number>`coalesce(sum(case when ${chatMessages.source} = 'AI 補充' then 1 else 0 end), 0)`,
    }).from(chatMessages).where(eq(chatMessages.role, "mentor"));
    const [indexSetting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    return Response.json({ documents: rows.map((row) => {
      const result = storedDocumentAnalysis(row.processingResultJson);
      const counts = storedDocumentStats(row.processingResultJson, row.chapterCount, row.questionCount);
      const chapters = Array.isArray(result.chapters) ? result.chapters.slice(0, 12) : [];
      const questions = Array.isArray(result.questions) ? result.questions.slice(0, 12) : [];
      return {
        id: row.id,
        name: row.fileName,
        subject: row.subject,
        type: row.documentType,
        sizeBytes: row.sizeBytes,
        status: row.status,
        error: row.indexError,
        processingStage: row.processingStage === "queued" && row.status === "completed" ? "completed" : row.processingStage,
        processingMessage: row.processingMessage,
        pageCount: row.pageCount,
        extractedChars: row.extractedChars,
        chapterCount: counts.chapterCount,
        topicCount: counts.topicCount,
        questionCount: counts.questionCount,
        tags: (() => { try { return JSON.parse(row.tagsJson); } catch { return []; } })(),
        fullTextIndexed: row.fullTextIndexed,
        vectorIndexed: row.vectorIndexed,
        summary: typeof result.summary === "string" ? result.summary : "",
        sourceFileName: typeof result.sourceFileName === "string" ? result.sourceFileName : row.fileName,
        indexedFileName: typeof result.indexedFileName === "string" ? result.indexedFileName : row.fileName,
        extractionNote: typeof result.extractionNote === "string" ? result.extractionNote : "",
        analysisStatus: typeof result.analysisStatus === "string" ? result.analysisStatus : "",
        chapters,
        questions,
        processedAt: row.processedAt,
        createdAt: row.createdAt,
      };
    }), stats: {
      total: Number(documentStats?.total ?? 0),
      ready: Number(documentStats?.ready ?? 0),
      indexedBytes: Number(documentStats?.indexedBytes ?? 0),
      citations: Number(usageStats?.citations ?? 0),
      misses: Number(usageStats?.misses ?? 0),
      indexVersion: indexSetting ? `VS-${new Date(indexSetting.updatedAt).toISOString().slice(0, 10).replaceAll("-", "")}` : "待建立",
    } });
  } catch {
    return Response.json({ error: "教材資料庫尚未就緒" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const subject = String(form.get("subject") ?? "").trim();
    const documentType = String(form.get("documentType") ?? "").trim();

    if (!(file instanceof File) || !isSupportedDocument(file.name, file.type)) {
      return Response.json({ error: "請上傳 PDF、JSONL、MD、TXT、DOCX 或 ZIP 文件" }, { status: 400 });
    }
    if (!subject || !documentType) {
      return Response.json({ error: "請選擇科目與文件類型" }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return Response.json({ error: "教材文件不可超過 55MB" }, { status: 413 });
    }

    const { env } = await import("cloudflare:workers");
    const bucket = env.BUCKET;
    if (!bucket) return Response.json({ error: "文件儲存空間尚未就緒" }, { status: 503 });

    const key = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
    await bucket.put(key, file.stream(), {
      httpMetadata: { contentType: contentTypeForDocument(file.name, file.type) },
      customMetadata: { subject, documentType, originalName: file.name },
    });

    try {
      const db = await getDb();
      const [row] = await db.insert(documents).values({
        storageKey: key,
        fileName: file.name,
        contentType: contentTypeForDocument(file.name, file.type),
        sizeBytes: file.size,
        subject,
        documentType,
        status: "uploaded",
      }).returning();
      return Response.json({ document: { id: row.id, name: row.fileName, status: row.status } }, { status: 201 });
    } catch (error) {
      await bucket.delete(key);
      throw error;
    }
  } catch {
    return Response.json({ error: "文件上傳失敗" }, { status: 500 });
  }
}
