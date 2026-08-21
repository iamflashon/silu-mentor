import { desc, like } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
  const db = await getDb();
  const rows = await db.select().from(appSettings).where(like(appSettings.key, `document_search_test:${documentId}:%`)).orderBy(desc(appSettings.updatedAt)).limit(10);
  return Response.json({ runs: rows.map((row) => { try { return JSON.parse(row.value); } catch { return null; } }).filter(Boolean) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { documentId?: unknown; documentName?: unknown; results?: unknown };
  const documentId = Number(body.documentId);
  const results = Array.isArray(body.results) ? body.results.slice(0, 20) : [];
  if (!Number.isInteger(documentId) || documentId < 1 || !results.length) return Response.json({ error: "測試紀錄內容不完整" }, { status: 400 });
  const now = new Date();
  const run = { id: `${documentId}-${now.getTime()}`, documentId, documentName: String(body.documentName ?? "教材"), createdAt: now.toISOString(), passed: results.filter((item) => item && typeof item === "object" && Boolean((item as { hit?: unknown }).hit)).length, total: results.length, results };
  const db = await getDb();
  await db.insert(appSettings).values({ key: `document_search_test:${documentId}:${now.getTime()}`, value: JSON.stringify(run), updatedAt: now });
  return Response.json({ run });
}
