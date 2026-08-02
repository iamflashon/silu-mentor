import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, documents } from "../../../db/schema";
import { appSettings } from "../../../db/schema";
import { openAIJson } from "../../../lib/openai";

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

export async function GET() {
  try {
    const db = await getDb();
    let rows = await db.select().from(documents).orderBy(desc(documents.createdAt)).limit(50);
    const processing = rows.filter((row) => row.openaiFileId && ["in_progress", "uploading_to_index"].includes(row.status));
    if (processing.length) {
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
      if (setting?.value) {
        await Promise.all(processing.map(async (row) => {
          try {
            const result = await openAIJson(`/vector_stores/${setting.value}/files/${row.openaiFileId}`);
            const status = typeof result.status === "string" ? result.status : row.status;
            await db.update(documents).set({ status, indexError: status === "failed" ? "索引服務未能處理此文件" : null }).where(eq(documents.id, row.id));
          } catch { /* keep last known status */ }
        }));
        rows = await db.select().from(documents).where(inArray(documents.id, rows.map((row) => row.id))).orderBy(desc(documents.createdAt));
      }
    }
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
    return Response.json({ documents: rows.map((row) => ({
      id: row.id,
      name: row.fileName,
      subject: row.subject,
      type: row.documentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      error: row.indexError,
      createdAt: row.createdAt,
    })), stats: {
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

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return Response.json({ error: "請上傳 PDF 文件" }, { status: 400 });
    }
    if (!subject || !documentType) {
      return Response.json({ error: "請選擇科目與文件類型" }, { status: 400 });
    }
    if (file.size > 55 * 1024 * 1024) {
      return Response.json({ error: "PDF 不可超過 55MB" }, { status: 413 });
    }

    const { env } = await import("cloudflare:workers");
    const bucket = env.BUCKET;
    if (!bucket) return Response.json({ error: "文件儲存空間尚未就緒" }, { status: 503 });

    const key = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
    await bucket.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { subject, documentType, originalName: file.name },
    });

    try {
      const db = await getDb();
      const [row] = await db.insert(documents).values({
        storageKey: key,
        fileName: file.name,
        contentType: file.type,
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
