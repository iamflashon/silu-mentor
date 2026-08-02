import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { documents } from "../../../db/schema";

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(documents).orderBy(desc(documents.createdAt)).limit(50);
    return Response.json({ documents: rows.map((row) => ({
      id: row.id,
      name: row.fileName,
      subject: row.subject,
      type: row.documentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: row.createdAt,
    })) });
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
