import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { DELETE as deleteDocuments, GET as getDocuments, PATCH as patchDocument, POST as postDocument } from "../../documents/route";

export function GET(request: Request) {
  const url = new URL(request.url); url.searchParams.set("category", "accounting");
  return getDocuments(new Request(url, request));
}
export async function POST(request: Request) {
  const form = await request.formData(); form.set("examCategory", "accounting");
  return postDocument(new Request(request.url, { method: "POST", body: form, headers: request.headers }));
}
export async function PATCH(request: Request) {
  const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean };
  const db = await getDb();
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, Number(body.id)), eq(documents.examCategory, "accounting"))).limit(1);
  if (!row) return Response.json({ error: "找不到中會教材" }, { status: 404 });
  return patchDocument(new Request(request.url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}
export async function DELETE(request: Request) {
  const body = await request.json() as { ids?: unknown[] };
  const ids = (body.ids ?? []).map(Number).filter(Number.isInteger);
  const db = await getDb();
  const allowed = ids.length ? await db.select({ id: documents.id }).from(documents).where(and(eq(documents.examCategory, "accounting"), inArray(documents.id, ids))) : [];
  return deleteDocuments(new Request(request.url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: allowed.map(row => row.id) }) }));
}
