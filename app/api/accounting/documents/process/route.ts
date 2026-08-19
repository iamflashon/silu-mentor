import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { POST as processDocument } from "../../../documents/process/route";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";

export async function POST(request: Request) {
  const auth = await requireAccountingAdmin(request); if ("error" in auth) return auth.error;
  const body = await request.json() as { documentId?: number; retry?: boolean };
  const documentId = Number(body.documentId);
  const db = await getDb();
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "accounting"))).limit(1);
  if (!row) return Response.json({ error: "找不到中會教材" }, { status: 404 });
  const headers = new Headers(request.headers); headers.set("content-type", "application/json");
  return processDocument(new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) }));
}
