import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentAssignments, documents } from "../../../../db/schema";

const categories = new Set(["law", "medtech", "accounting", "data-structure"]);

export async function GET(request: Request) {
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
  const db = await getDb();
  const rows = await db.select().from(documentAssignments).where(eq(documentAssignments.documentId, documentId)).orderBy(asc(documentAssignments.sortOrder), asc(documentAssignments.id));
  if (rows.length) return Response.json({ assignments: rows, legacyFallback: false });
  const [document] = await db.select({ examCategory: documents.examCategory, subject: documents.subject }).from(documents).where(eq(documents.id, documentId)).limit(1);
  return Response.json({ assignments: document ? [{ id: 0, documentId, examCategory: document.examCategory, subject: document.subject, usageType: "教材檢索", visibility: "members", aiSearchEnabled: true, sortOrder: 0 }] : [], legacyFallback: true });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { documentId?: number; assignments?: Array<{ examCategory?: string; subject?: string; usageType?: string; visibility?: string; aiSearchEnabled?: boolean }> };
    const documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1 || !Array.isArray(body.assignments)) return Response.json({ error: "教材關聯資料不正確" }, { status: 400 });
    const normalized = body.assignments.map((item, index) => ({
      documentId,
      examCategory: String(item.examCategory ?? "").trim(),
      subject: String(item.subject ?? "綜合").trim() || "綜合",
      usageType: String(item.usageType ?? "教材檢索").trim() || "教材檢索",
      visibility: ["admin", "teachers", "members"].includes(String(item.visibility)) ? String(item.visibility) : "members",
      aiSearchEnabled: item.aiSearchEnabled !== false,
      sortOrder: index,
      updatedAt: new Date(),
    })).filter((item) => categories.has(item.examCategory));
    if (!normalized.length) return Response.json({ error: "至少保留一個使用平台" }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    await db.delete(documentAssignments).where(eq(documentAssignments.documentId, documentId));
    await db.insert(documentAssignments).values(normalized);
    return Response.json({ assignments: normalized });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "教材關聯儲存失敗" }, { status: 500 });
  }
}
