import { desc, like } from "drizzle-orm";
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

function summaryView(row: typeof documents.$inferSelect) {
  const result = parseResult(row.processingResultJson);
  const usage = result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : null;
  return {
    id: row.id,
    name: row.fileName,
    subject: row.subject,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    status: row.status,
    processingStage: row.processingStage,
    processingMessage: row.processingMessage,
    error: row.indexError,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    summary: String(result.summary ?? ""),
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
      .where(like(documents.storageKey, `${studentSummaryStoragePrefix(request)}%`))
      .orderBy(desc(documents.createdAt)).limit(50);
    return Response.json({ summaries: rows.map(summaryView) });
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
      customMetadata: { originalName: file.name, subject, purpose: "student-summary" },
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
