import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { requireMedtechAdmin } from "../../../../lib/member-auth";
import { DELETE as deleteDocuments, GET as getDocuments, PATCH as patchDocument, POST as postDocument } from "../../documents/route";

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url); url.searchParams.set("category", "medtech");
  return getDocuments(new Request(url, { headers: request.headers }));
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData(); form.set("examCategory", "medtech");
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return postDocument(new Request(request.url, { method: "POST", headers, body: form }));
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean };
  const db = await getDb();
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, Number(body.id)), eq(documents.examCategory, "medtech"))).limit(1);
  if (!row) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
  return patchDocument(new Request(request.url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

export async function DELETE(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { ids?: unknown[] };
  const ids = (body.ids ?? []).map(Number).filter(Number.isInteger);
  const db = await getDb();
  const allowed = ids.length ? await db.select({ id: documents.id }).from(documents).where(and(eq(documents.examCategory, "medtech"), inArray(documents.id, ids))) : [];
  return deleteDocuments(new Request(request.url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: allowed.map(row => row.id) }) }));
}
