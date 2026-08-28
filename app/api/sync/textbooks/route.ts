import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentAssignments, documentSearchUnits, documents } from "../../../../db/schema";
import { verifySitesCloudflareSyncToken } from "../../../../lib/sites-cloudflare-sync-token";

function bearer(request: Request) {
  const url = new URL(request.url);
  return request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "").trim() || url.searchParams.get("token")?.trim() || "";
}

export async function GET(request: Request) {
  if (!await verifySitesCloudflareSyncToken(bearer(request))) return Response.json({ error: "教材同步設定已失效，請回來源後台重新下載" }, { status: 401 });
  const url = new URL(request.url);
  const db = await getDb("primary");
  const documentId = Number(url.searchParams.get("documentId"));

  if (Number.isInteger(documentId) && documentId > 0) {
    const [document] = await db.select({ fileName: documents.fileName, storageKey: documents.storageKey, contentType: documents.contentType })
      .from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "來源環境找不到這份教材" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "來源環境有教材紀錄，但原始檔不存在" }, { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": object.httpMetadata?.contentType || document.contentType || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "Cache-Control": "private, no-store",
    } });
  }

  if (url.searchParams.get("action") !== "manifest" || url.searchParams.get("scope") !== "pengli") return Response.json({ error: "同步範圍不正確" }, { status: 400 });
  const fields = {
    id: documents.id, fileName: documents.fileName, storageKey: documents.storageKey, contentType: documents.contentType, sizeBytes: documents.sizeBytes,
    examCategory: documents.examCategory, bookTitle: documents.bookTitle, subject: documents.subject, documentType: documents.documentType,
    status: documents.status, pageCount: documents.pageCount, extractedChars: documents.extractedChars, tagsJson: documents.tagsJson,
  };
  const assigned = await db.select(fields).from(documentAssignments).innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true))).orderBy(desc(documents.id)).limit(30);
  const recognized = await db.select(fields).from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%"))).orderBy(desc(documents.id)).limit(30);
  const unique = [...new Map([...assigned, ...recognized].map((document) => [document.id, document])).values()];
  const { env } = await import("cloudflare:workers");
  const manifest = await Promise.all(unique.map(async (document) => {
    const [{ units, pages }] = await db.select({ units: sql<number>`count(*)`, pages: sql<number>`count(distinct ${documentSearchUnits.pageStart})` })
      .from(documentSearchUnits).where(eq(documentSearchUnits.documentId, document.id));
    const { storageKey, ...metadata } = document;
    return { ...metadata, sourceAvailable: Boolean(await env.BUCKET?.head(storageKey)), indexedUnits: Number(units), indexedPages: Number(pages) };
  }));
  return Response.json({ scope: "pengli", documents: manifest }, { headers: { "Cache-Control": "private, no-store" } });
}
