import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { POST as processDocument } from "../../../documents/process/route";

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { documentId?: number; retry?: boolean };
  const documentId = Number(body.documentId);
  const db = await getDb();
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
  if (!row) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
  return processDocument(new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}
