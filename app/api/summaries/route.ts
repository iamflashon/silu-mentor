import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { documents } from "../../../db/schema";
import {
  isSupportedStudentSummaryFile,
  safeStudentSummaryName,
  STUDENT_SUMMARY_MAX_BYTES,
  studentSummaryStoragePrefix,
  summaryContentType,
} from "../../../lib/student-summary";

function parseResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function publicProcessingMessage(value: string | null | undefined) {
  const message = String(value ?? "").trim();
  if (/failed query|select\s+["'`]|\bfrom\s+["'`]|sqlite|database/i.test(message)) {
    return "資料暫時無法讀取；可刪除後重新上傳。";
  }
  return message.slice(0, 500);
}

function summaryView(row: typeof documents.$inferSelect) {
  const result = parseResult(row.processingResultJson);
  const usage = result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : null;
  return {
    id: row.id,
    name: row.fileName,
    displayTitle: String(result.title ?? row.fileName),
    subject: row.subject,
    topic: String(result.topic ?? ""),
    collectionTitle: String(result.collectionTitle ?? result.topic ?? ""),
    folder: String(result.folder ?? "未分類"),
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    status: row.status,
    processingStage: row.processingStage,
    processingMessage: publicProcessingMessage(row.processingMessage),
    error: publicProcessingMessage(row.indexError),
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    summary: String(result.summary ?? ""),
    editedSummary: String(result.editedSummary ?? ""),
    favorite: Boolean(result.favorite),
    examFocus: String(result.examFocus ?? ""),
    keyPoints: stringArray(result.keyPoints),
    issueOutline: stringArray(result.issueOutline),
    commonMistakes: stringArray(result.commonMistakes),
    sourceNotes: stringArray(result.sourceNotes),
    tags: stringArray(result.tags),
    flashcards: Array.isArray(result.flashcards)
      ? result.flashcards.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const card = item as Record<string, unknown>;
          const question = String(card.question ?? "").trim();
          const answer = String(card.answer ?? "").trim();
          return question && answer ? [{ question, answer }] : [];
        }).slice(0, 12)
      : [],
    model: String(result.model ?? ""),
    fontSize: [16, 18, 20, 22, 24].includes(Number(result.fontSize)) ? Number(result.fontSize) : 20,
    billing: { status: "not-enabled", points: 0 },
    usage: usage
      ? {
          inputTokens: Number(usage.inputTokens ?? 0),
          cachedTokens: Number(usage.cachedTokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? 0),
          estimatedCostUsd: Number(usage.estimatedCostUsd ?? 0),
        }
      : null,
  };
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const rows = await db.select().from(documents)
      .where(eq(documents.documentType, "student-summary"))
      .orderBy(desc(documents.createdAt)).limit(200);
    const prefix = studentSummaryStoragePrefix(request);
    return Response.json({ summaries: rows.filter((row) => row.storageKey.startsWith(prefix)).slice(0, 50).map(summaryView) });
  } catch {
    return Response.json({ error: "整理摘要資料暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let storageKey = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const subject = String(form.get("subject") ?? "綜合").trim() || "綜合";
    const topic = String(form.get("topic") ?? "").trim().slice(0, 120);
    if (!(file instanceof File) || !isSupportedStudentSummaryFile(file.name, file.type)) {
      return Response.json({ error: "請上傳 PDF、PNG、JPG、WEBP、TXT 或 JSONL" }, { status: 400 });
    }
    if (file.size < 1 || file.size > STUDENT_SUMMARY_MAX_BYTES) {
      return Response.json({ error: "單一檔案不可超過 25MB" }, { status: 413 });
    }
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "檔案儲存空間尚未就緒" }, { status: 503 });
    storageKey = `${studentSummaryStoragePrefix(request)}${Date.now()}-${crypto.randomUUID()}-${safeStudentSummaryName(file.name)}`;
    await env.BUCKET.put(storageKey, file.stream(), {
      httpMetadata: { contentType: summaryContentType(file.name, file.type) },
      customMetadata: { originalName: file.name, subject, topic, purpose: "student-summary" },
    });
    const db = await getDb();
    const [row] = await db.insert(documents).values({
      storageKey,
      fileName: file.name,
      contentType: summaryContentType(file.name, file.type),
      sizeBytes: file.size,
      subject,
      documentType: "student-summary",
      status: "uploaded",
      processingStage: "queued",
      processingMessage: "等待 AI 整理",
      processingResultJson: JSON.stringify({ topic }),
    }).returning();
    return Response.json({ summary: summaryView(row) }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      try {
        const { env } = await import("cloudflare:workers");
        await env.BUCKET?.delete(storageKey);
      } catch { /* preserve the upload error */ }
    }
    return Response.json({ error: error instanceof Error ? error.message : "檔案上傳失敗" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: number; editedSummary?: string; favorite?: boolean; tags?: string[]; title?: string; fontSize?: number; topic?: string; collectionTitle?: string; folder?: string; subject?: string };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "摘要編號不正確" }, { status: 400 });
    const db = await getDb();
    const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row || !row.storageKey.startsWith(studentSummaryStoragePrefix(request)) || row.documentType !== "student-summary") return Response.json({ error: "找不到這份整理摘要" }, { status: 404 });
    const result = parseResult(row.processingResultJson);
    if (typeof body.editedSummary === "string") result.editedSummary = body.editedSummary.slice(0, 30_000);
    if (typeof body.favorite === "boolean") result.favorite = body.favorite;
    if (Array.isArray(body.tags)) result.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20);
    if (typeof body.title === "string") result.title = body.title.trim().slice(0, 120) || row.fileName;
    if (typeof body.topic === "string") result.topic = body.topic.trim().slice(0, 120);
    if (typeof body.collectionTitle === "string") result.collectionTitle = body.collectionTitle.trim().slice(0, 120);
    if (typeof body.folder === "string") result.folder = body.folder.trim().slice(0, 80) || "未分類";
    if (typeof body.fontSize === "number" && [16, 18, 20, 22, 24].includes(body.fontSize)) result.fontSize = body.fontSize;
    await db.update(documents).set({
      subject: typeof body.subject === "string" ? body.subject.trim().slice(0, 40) || row.subject : row.subject,
      processingResultJson: JSON.stringify(result),
      tagsJson: JSON.stringify(Array.isArray(result.tags) ? result.tags : []),
    }).where(eq(documents.id, id));
    const [updated] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return Response.json({ summary: updated ? summaryView(updated) : null });
  } catch {
    return Response.json({ error: "摘要保存失敗" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
      : [];
    if (!ids.length) return Response.json({ error: "請先選取要刪除的摘要" }, { status: 400 });
    if (ids.length > 50) return Response.json({ error: "一次最多刪除 50 份摘要" }, { status: 400 });

    const prefix = studentSummaryStoragePrefix(request);
    const db = await getDb();
    const rows = await db.select({ id: documents.id, storageKey: documents.storageKey })
      .from(documents)
      .where(and(eq(documents.documentType, "student-summary"), inArray(documents.id, ids)));
    const ownedRows = rows.filter((row) => row.storageKey.startsWith(prefix));
    if (!ownedRows.length) return Response.json({ error: "找不到可刪除的摘要" }, { status: 404 });

    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "檔案儲存空間尚未就緒，摘要未刪除" }, { status: 503 });
    for (const row of ownedRows) await env.BUCKET.delete(row.storageKey);

    await db.delete(documents).where(and(eq(documents.documentType, "student-summary"), inArray(documents.id, ownedRows.map((row) => row.id))));
    return Response.json({ ok: true, deletedIds: ownedRows.map((row) => row.id), deletedCount: ownedRows.length });
  } catch {
    return Response.json({ error: "摘要刪除失敗，請稍後再試" }, { status: 500 });
  }
}
