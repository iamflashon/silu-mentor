import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, documentAssignments, documentSearchUnits, documents, examQuestions } from "../../../db/schema";
import { appSettings } from "../../../db/schema";
import { contentTypeForDocument, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../lib/document-processing";
import { storedDocumentAnalysis, storedDocumentStats } from "../../../lib/document-analysis";
import { documentDisplayTitle, normalizeDocumentTitle } from "../../../lib/document-title";
import { openAIJson } from "../../../lib/openai";

function processingResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sourceVariants(value: string) {
  const result = processingResult(value);
  return Array.isArray(result.sourceVariants)
    ? result.sourceVariants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).storageKey === "string"))
    : [];
}

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

function isPengliMaterial(...values: Array<string | null | undefined>) {
  const signature = values.filter(Boolean).join(" ").normalize("NFKC");
  return /彭狸|59ML170502|行政法考點(?:（考前衝刺）)?演習書/u.test(signature);
}

export async function GET(request: Request) {
  try {
    const db = await getDb("primary");
    const params = new URL(request.url).searchParams;
    const category = params.get("category")?.trim();
    const requestedId = Number(params.get("id"));
    const documentId = Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null;
    const requestedLimit = Number(params.get("limit"));
    const listLimit = Number.isInteger(requestedLimit) ? Math.min(500, Math.max(1, requestedLimit)) : 50;
    // Do not pull an unbounded processingResultJson into every admin list
    // request. Older HTML imports may contain a very large serialized result;
    // selecting that column for 50 documents can exceed the Worker memory
    // limit before the response is even built. Small results still provide
    // rich metadata and source variants; large documents use scalar counts and
    // can be opened normally through their dedicated source endpoint.
    const rows = await db.select({
      id: documents.id,
      storageKey: documents.storageKey,
      fileName: documents.fileName,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      examCategory: documents.examCategory,
      bookTitle: documents.bookTitle,
      subject: documents.subject,
      documentType: documents.documentType,
      status: documents.status,
      indexError: documents.indexError,
      processingStage: documents.processingStage,
      processingMessage: documents.processingMessage,
      pageCount: documents.pageCount,
      extractedChars: documents.extractedChars,
      chapterCount: documents.chapterCount,
      questionCount: documents.questionCount,
      tagsJson: documents.tagsJson,
      processingResultJson: sql<string>`case when length(${documents.processingResultJson}) <= 2000000 then ${documents.processingResultJson} else '{}' end`,
      fullTextIndexed: documents.fullTextIndexed,
      vectorIndexed: documents.vectorIndexed,
      homepageSearchEnabled: documents.homepageSearchEnabled,
      assignmentCount: sql<number>`(select count(*) from ${documentAssignments} where ${documentAssignments.documentId} = ${documents.id})`,
      assignmentCategories: sql<string>`coalesce((select group_concat(${documentAssignments.examCategory}, ',') from ${documentAssignments} where ${documentAssignments.documentId} = ${documents.id}), '')`,
      processedAt: documents.processedAt,
      createdAt: documents.createdAt,
    }).from(documents).where(category && documentId ? and(eq(documents.examCategory, category), eq(documents.id, documentId)) : category ? eq(documents.examCategory, category) : documentId ? eq(documents.id, documentId) : undefined).orderBy(desc(documents.createdAt)).limit(documentId ? 1 : listLimit);
    // D1 can return a stale value for a correlated count subquery even when the
    // same primary-anchored session sees every row in a direct aggregate. Read
    // the fine-index totals explicitly and merge them by document id.
    const fineIndexCounts = rows.length ? await db.select({
      documentId: documentSearchUnits.documentId,
      total: sql<number>`count(*)`,
    }).from(documentSearchUnits).where(inArray(documentSearchUnits.documentId, rows.map((row) => row.id))).groupBy(documentSearchUnits.documentId) : [];
    const fineIndexCountByDocument = new Map(fineIndexCounts.map((row) => [row.documentId, Number(row.total)]));
    const questionCounts = await db.select({
      sourceUrl: examQuestions.sourceUrl,
      subject: examQuestions.subject,
      total: sql<number>`count(*)`,
      draftTotal: sql<number>`coalesce(sum(case when ${examQuestions.status} = 'draft' then 1 else 0 end), 0)`,
    }).from(examQuestions).groupBy(examQuestions.sourceUrl, examQuestions.subject);
    const questionStats = (row: typeof rows[number]) => {
      const aliases = new Set([`document:${row.id}`, row.storageKey, row.fileName]);
      const exact = questionCounts.find((item) => aliases.has(item.sourceUrl));
      if (exact) return { total: Number(exact.total), draftTotal: Number(exact.draftTotal) };
      const sameSubject = questionCounts.filter((item) => item.subject === row.subject);
      return sameSubject.length === 1
        ? { total: Number(sameSubject[0].total), draftTotal: Number(sameSubject[0].draftTotal) }
        : { total: Number(row.questionCount ?? 0), draftTotal: 0 };
    };
    const [documentStats] = await db.select({
      total: sql<number>`count(*)`,
      ready: sql<number>`coalesce(sum(case when ${documents.status} = 'completed' then 1 else 0 end), 0)`,
      vectorReady: sql<number>`coalesce(sum(case when ${documents.vectorIndexed} = true then 1 else 0 end), 0)`,
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
      const questionStatsForDocument = questionStats(row);
      const chapters = Array.isArray(result.chapters) ? result.chapters.slice(0, 12) : [];
      const questions = Array.isArray(result.questions) ? result.questions.slice(0, 12) : [];
      return {
        id: row.id,
        name: row.fileName,
        examCategory: row.examCategory,
        bookTitle: row.bookTitle,
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
        questionCount: questionStatsForDocument.total,
        draftQuestionCount: questionStatsForDocument.draftTotal,
        indexedQuestionCount: Number(row.questionCount ?? counts.questionCount ?? 0),
        tags: (() => { try { return JSON.parse(row.tagsJson); } catch { return []; } })(),
        fullTextIndexed: row.fullTextIndexed,
        vectorIndexed: row.vectorIndexed,
        homepageSearchEnabled: row.homepageSearchEnabled,
        fineSearchUnitCount: fineIndexCountByDocument.get(row.id) ?? 0,
        assignmentCount: Math.max(1, Number(row.assignmentCount ?? 0)),
        assignmentCategories: row.assignmentCategories ? [...new Set(row.assignmentCategories.split(",").filter(Boolean))] : [row.examCategory],
        summary: typeof result.summary === "string" ? result.summary : "",
        sourceFileName: typeof result.sourceFileName === "string" ? result.sourceFileName : row.fileName,
        indexedFileName: typeof result.indexedFileName === "string" ? result.indexedFileName : row.fileName,
        sourceVariants: sourceVariants(row.processingResultJson).map((item) => ({
          kind: typeof item.kind === "string" ? item.kind : "other",
          storageKey: typeof item.storageKey === "string" ? item.storageKey : "",
          fileName: typeof item.fileName === "string" ? item.fileName : "原稿版本",
          contentType: typeof item.contentType === "string" ? item.contentType : "application/octet-stream",
          sizeBytes: Number(item.sizeBytes ?? 0),
        })),
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
      vectorReady: Number(documentStats?.vectorReady ?? 0),
      indexedBytes: Number(documentStats?.indexedBytes ?? 0),
      citations: Number(usageStats?.citations ?? 0),
      misses: Number(usageStats?.misses ?? 0),
      indexVersion: indexSetting ? `VS-${new Date(indexSetting.updatedAt).toISOString().slice(0, 10).replaceAll("-", "")}` : "待建立",
    } }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0" } });
  } catch {
    return Response.json({ error: "教材資料庫尚未就緒" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const subject = String(form.get("subject") ?? "").trim();
    const requestedExamCategory = String(form.get("examCategory") ?? "law").trim();
    const examCategory = ["law", "accounting", "medtech"].includes(requestedExamCategory) ? requestedExamCategory : "law";
    const requestedBookTitle = normalizeDocumentTitle(String(form.get("bookTitle") ?? ""));
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
      customMetadata: { subject, documentType, bookTitle: requestedBookTitle || documentDisplayTitle(null, file.name), originalName: file.name },
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
        examCategory,
        bookTitle: requestedBookTitle || documentDisplayTitle(null, file.name),
        subject,
        documentType,
        status: "uploaded",
      }).returning();
      const assignments = [
        { documentId: row.id, examCategory, subject, usageType: "教材檢索", visibility: "members", aiSearchEnabled: true, sortOrder: 0 },
        ...(isPengliMaterial(file.name, requestedBookTitle, subject)
          ? [{ documentId: row.id, examCategory: "pengli", subject: "行政法", usageType: "教材檢索", visibility: "members", aiSearchEnabled: true, sortOrder: 1 }]
          : []),
      ];
      await db.insert(documentAssignments).values(assignments);
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
    const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean; bookTitle?: string };
    const id = Number(body.id);
    const hasBookTitle = typeof body.bookTitle === "string";
    const hasHomepageSearchSetting = typeof body.homepageSearchEnabled === "boolean";
    if (!Number.isInteger(id) || id < 1 || (!hasBookTitle && !hasHomepageSearchSetting)) {
      return Response.json({ error: "教材設定資料不正確" }, { status: 400 });
    }
    const db = await getDb();
    const [document] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    if (hasBookTitle) {
      const bookTitle = normalizeDocumentTitle(String(body.bookTitle ?? ""));
      if (!bookTitle) return Response.json({ error: "請輸入書籍名稱" }, { status: 400 });
      await db.update(documents).set({ bookTitle }).where(eq(documents.id, id));
      if (!hasHomepageSearchSetting) return Response.json({ id, bookTitle });
    }
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
