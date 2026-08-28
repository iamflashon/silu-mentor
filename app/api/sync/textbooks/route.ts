import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentAssignments, documents } from "../../../../db/schema";
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

  const scope = url.searchParams.get("scope") || "all";
  if (url.searchParams.get("action") !== "manifest" || !["all", "pengli", "law", "medtech", "accounting", "data-structure"].includes(scope)) return Response.json({ error: "同步範圍不正確" }, { status: 400 });
  const fields = {
    id: documents.id, fileName: documents.fileName, storageKey: documents.storageKey, contentType: documents.contentType, sizeBytes: documents.sizeBytes,
    examCategory: documents.examCategory, bookTitle: documents.bookTitle, subject: documents.subject, documentType: documents.documentType,
    status: documents.status, pageCount: documents.pageCount, extractedChars: documents.extractedChars, tagsJson: documents.tagsJson,
  };
  const allDocuments = await db.select(fields).from(documents).orderBy(desc(documents.id)).limit(500);
  const assignments: Array<{ documentId:number;examCategory:string;subject:string;usageType:string;visibility:string;aiSearchEnabled:boolean;sortOrder:number }> = [];
  for (let offset = 0; offset < allDocuments.length; offset += 100) {
    assignments.push(...await db.select({ documentId: documentAssignments.documentId, examCategory: documentAssignments.examCategory, subject: documentAssignments.subject, usageType: documentAssignments.usageType, visibility: documentAssignments.visibility, aiSearchEnabled: documentAssignments.aiSearchEnabled, sortOrder: documentAssignments.sortOrder })
      .from(documentAssignments).where(inArray(documentAssignments.documentId, allDocuments.slice(offset, offset + 100).map((document) => document.id))));
  }
  const assignmentsByDocument = new Map<number, typeof assignments>();
  for (const assignment of assignments) assignmentsByDocument.set(assignment.documentId, [...(assignmentsByDocument.get(assignment.documentId) || []), assignment]);
  const selected = scope === "all" ? allDocuments : allDocuments.filter((document) => {
    if (document.examCategory === scope || assignmentsByDocument.get(document.id)?.some((assignment) => assignment.examCategory === scope && assignment.aiSearchEnabled)) return true;
    return scope === "pengli" && (/59ML170502/iu.test(document.fileName) || /行政法考點/u.test(document.bookTitle));
  });
  const { env } = await import("cloudflare:workers");
  const manifest: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < selected.length; offset += 20) {
    manifest.push(...await Promise.all(selected.slice(offset, offset + 20).map(async (document) => {
      const { storageKey, ...metadata } = document;
      return { ...metadata, assignments: assignmentsByDocument.get(document.id) || [], sourceAvailable: Boolean(await env.BUCKET?.head(storageKey)) };
    })));
  }
  return Response.json({ scope, documents: manifest }, { headers: { "Cache-Control": "private, no-store" } });
}
