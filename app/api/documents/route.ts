import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, documents, examQuestions } from "../../../db/schema";
import { appSettings } from "../../../db/schema";
import { contentTypeForDocument, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../lib/document-processing";
import { storedDocumentAnalysis, storedDocumentStats } from "../../../lib/document-analysis";
import { openAIJson } from "../../../lib/openai";

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

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const category = new URL(request.url).searchParams.get("category")?.trim();
    const rows = await db.select().from(documents).where(category ? eq(documents.examCategory, category) : undefined).orderBy(desc(documents.createdAt)).limit(50);
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
        examCategory: row.examCategory,
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
        homepageSearchEnabled: row.homepageSearchEnabled,
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
    const examCategory = String(form.get("examCategory") ?? "law").trim();
    const documentType = String(form.get("documentType") ?? "").trim();

    if (!(file instanceof File) || !isSupportedDocument(file.name, file.type)) {
      return Response.json({ error: "請上傳 PDF、HTML、JSONL、MD、TXT、DOCX 或 ZIP 文件" }, { status: 400 });
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
    const stored = await bucket.head(key);
    if (!stored || stored.size !== file.size || stored.size < 1) {
      await bucket.delete(key).catch(() => undefined);
      return Response.json({ error: "檔案內容未完整寫入，請重新選擇原稿再上傳" }, { status: 500 });
    }

    try {
      const db = await getDb();
      const [row] = await db.insert(documents).values({
        storageKey: key,
        fileName: file.name,
        contentType: contentTypeForDocument(file.name, file.type),
        sizeBytes: file.size,
        examCategory: ["law", "accounting", "medtech"].includes(examCategory) ? examCategory : "law",
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

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { ids?: unknown[] };
    const ids = [...new Set((body.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
    if (!ids.length) return Response.json({ error: "請先選擇要刪除的教材" }, { status: 400 });

    const db = await getDb();
    const rows = await Promise.all(ids.map(async (id) => (await db.select().from(documents).where(eq(documents.id, id)).limit(1))[0]));
    const selected = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
    const { env } = await import("cloudflare:workers");
    const bucket = env.BUCKET;
    const [indexSetting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);

    for (const row of selected) {
      if (row.openaiFileId && indexSetting?.value) {
        await openAIJson(`/vector_stores/${indexSetting.value}/files/${row.openaiFileId}`, { method: "DELETE" }).catch(() => undefined);
        await openAIJson(`/files/${row.openaiFileId}`, { method: "DELETE" }).catch(() => undefined);
      }
      if (bucket) await bucket.delete(row.storageKey).catch(() => undefined);
      await db.delete(examQuestions).where(eq(examQuestions.sourceUrl, `document:${row.id}`));
      await db.delete(documents).where(eq(documents.id, row.id));
    }

    return Response.json({
      deleted: selected.length,
      deletedIds: selected.map((row) => row.id),
      deletedReady: selected.filter((row) => row.status === "completed").length,
      deletedIndexedBytes: selected.filter((row) => row.status === "completed").reduce((sum, row) => sum + row.sizeBytes, 0),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "教材刪除失敗" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1 || typeof body.homepageSearchEnabled !== "boolean") {
      return Response.json({ error: "首頁搜尋設定不正確" }, { status: 400 });
    }
    const db = await getDb();
    const [document] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    if (body.homepageSearchEnabled && document.status !== "completed") {
      return Response.json({ error: "教材仍在處理，完成全文／向量索引後才能開放首頁搜尋", code: "INDEX_NOT_READY", repairable: false }, { status: 409 });
    }
    if (body.homepageSearchEnabled && (!document.openaiFileId || !setting?.value)) {
      return Response.json({ error: "這是舊版教材索引，系統將自動補建後再開放首頁搜尋", code: "INDEX_REPAIR_REQUIRED", repairable: true }, { status: 409 });
    }
    if (body.homepageSearchEnabled && document.openaiFileId && setting?.value && !document.vectorIndexed) {
      const indexed = await openAIJson(`/vector_stores/${setting.value}/files/${document.openaiFileId}`).catch(() => null);
      if (indexed && indexed.status === "completed") {
        await db.update(documents).set({ fullTextIndexed: true, vectorIndexed: true, indexError: null }).where(eq(documents.id, id));
      } else {
        return Response.json({ error: "這是舊版教材索引，系統將自動補建後再開放首頁搜尋", code: "INDEX_REPAIR_REQUIRED", repairable: true }, { status: 409 });
      }
    }
    if (document.openaiFileId && setting?.value) {
      await openAIJson(`/vector_stores/${setting.value}/files/${document.openaiFileId}`, {
        method: "POST",
        body: JSON.stringify({ attributes: {
          exam_category: document.examCategory,
          subject: document.subject,
          document_type: document.documentType,
          source_file: document.fileName,
          homepage_enabled: body.homepageSearchEnabled,
        } }),
      });
    }
    await db.update(documents).set({ homepageSearchEnabled: body.homepageSearchEnabled }).where(eq(documents.id, id));
    return Response.json({ id, homepageSearchEnabled: body.homepageSearchEnabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "首頁搜尋設定更新失敗" }, { status: 500 });
  }
}
