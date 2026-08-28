import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentAssignments, documents } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { buildFineIndexStep } from "../../documents/fine-index/route";

type SyncConfig = { sourceUrl?: string; sitesUrl?: string; token?: string };
type SyncScope = "all" | "pengli" | "law" | "medtech" | "accounting" | "data-structure";

function sourceOrigin(config: SyncConfig) { return String(config.sourceUrl || config.sitesUrl || ""); }

function validConfig(config: SyncConfig) {
  try {
    const url = new URL(sourceOrigin(config));
    return url.protocol === "https:" && Boolean(config.token?.trim());
  } catch { return false; }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { action?: string; documentId?: number; sourceDocumentId?: number; scope?: SyncScope; config?: SyncConfig; restart?: boolean };
  const scope: SyncScope = ["all", "pengli", "law", "medtech", "accounting", "data-structure"].includes(String(body.scope)) ? body.scope! : "all";
  const db = await getDb("primary");
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "Cloudflare R2 尚未綁定" }, { status: 503 });
  if (body.action === "source-manifest") {
    if (!validConfig(body.config || {})) return Response.json({ error: "請先匯入來源環境的同步設定" }, { status: 400 });
    const sourceUrl = new URL("/api/sync/textbooks", sourceOrigin(body.config!));
    sourceUrl.searchParams.set("action", "manifest"); sourceUrl.searchParams.set("scope", scope);
    const response = await fetch(sourceUrl, { headers: { Authorization: `Bearer ${body.config!.token}` }, redirect: "manual" });
    if (!response.ok) return Response.json({ error: response.status >= 300 && response.status < 400 ? "來源網站的同步入口被登入保護擋住，請將 /api/sync/textbooks 設為免登入但保留同步簽章驗證" : (await response.json().catch(() => ({})) as { error?: string }).error || `讀取來源教材失敗（${response.status}）` }, { status: 502 });
    return Response.json(await response.json());
  }
  if (body.action === "import-document" || body.action === "import-pengli") {
    if (!validConfig(body.config || {})) return Response.json({ error: "請先匯入來源環境的同步設定" }, { status: 400 });
    const sourceDocumentId = Number(body.sourceDocumentId);
    if (!Number.isInteger(sourceDocumentId) || sourceDocumentId < 1) return Response.json({ error: "來源教材編號不正確" }, { status: 400 });
    const manifestUrl = new URL("/api/sync/textbooks", sourceOrigin(body.config!));
    manifestUrl.searchParams.set("action", "manifest"); manifestUrl.searchParams.set("scope", scope);
    const manifestResponse = await fetch(manifestUrl, { headers: { Authorization: `Bearer ${body.config!.token}` } });
    const manifest = await manifestResponse.json().catch(() => ({})) as { documents?: Array<{ id:number;fileName:string;contentType:string;sizeBytes:number;examCategory:string;bookTitle:string;subject:string;documentType:string;status:string;pageCount:number|null;extractedChars:number;tagsJson:string;assignments?:Array<{examCategory:string;subject:string;usageType:string;visibility:string;aiSearchEnabled:boolean;sortOrder:number}> }> ; error?: string };
    if (!manifestResponse.ok) return Response.json({ error: manifest.error || "無法讀取來源教材清單" }, { status: 502 });
    const sourceDocument = manifest.documents?.find((document) => document.id === sourceDocumentId);
    if (!sourceDocument) return Response.json({ error: "來源教材已不存在，請重新讀取清單" }, { status: 404 });
    const fileUrl = new URL("/api/sync/textbooks", sourceOrigin(body.config!)); fileUrl.searchParams.set("documentId", String(sourceDocumentId));
    const source = await fetch(fileUrl, { headers: { Authorization: `Bearer ${body.config!.token}` } });
    if (!source.ok) return Response.json({ error: (await source.json().catch(() => ({})) as { error?: string }).error || `下載來源教材失敗（${source.status}）` }, { status: 502 });
    const bytes = await source.arrayBuffer();
    if (!bytes.byteLength) return Response.json({ error: "來源教材內容是空的" }, { status: 502 });
    const sourceHost = new URL(sourceOrigin(body.config!)).hostname.replace(/[^a-z0-9.-]+/giu, "-");
    const storageKey = `documents/environment-sync-${sourceHost}-${sourceDocumentId}-${sourceDocument.fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-")}`;
    const [existing] = await db.select().from(documents).where(eq(documents.storageKey, storageKey)).limit(1);
    await env.BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: source.headers.get("content-type") || sourceDocument.contentType }, customMetadata: { source: "cloudflare-to-sites-textbook-sync", originalName: sourceDocument.fileName } });
    let documentId = existing?.id;
    const metadata = { storageKey, contentType: sourceDocument.contentType, sizeBytes: bytes.byteLength, examCategory: sourceDocument.examCategory, bookTitle: sourceDocument.bookTitle, subject: sourceDocument.subject, documentType: sourceDocument.documentType, status: sourceDocument.status || "uploaded", pageCount: sourceDocument.pageCount, extractedChars: sourceDocument.extractedChars || 0, tagsJson: sourceDocument.tagsJson || "[]", processingResultJson: JSON.stringify({ environmentSync: { source: sourceOrigin(body.config!), documentId: sourceDocumentId } }), processingMessage: "已從來源環境同步，等待精準索引", processingStage: "indexing" };
    if (existing) await db.update(documents).set(metadata).where(eq(documents.id, existing.id));
    else {
      const [created] = await db.insert(documents).values({ ...metadata, fileName: sourceDocument.fileName }).returning({ id: documents.id });
      documentId = created.id;
    }
    const sourceAssignments = sourceDocument.assignments?.length ? sourceDocument.assignments : [{ examCategory: sourceDocument.examCategory, subject: sourceDocument.subject || "綜合", usageType: "教材檢索", visibility: "members", aiSearchEnabled: true, sortOrder: 0 }];
    for (const sourceAssignment of sourceAssignments) {
      const [assignment] = await db.select({ id: documentAssignments.id }).from(documentAssignments)
        .where(and(eq(documentAssignments.documentId, documentId!), eq(documentAssignments.examCategory, sourceAssignment.examCategory), eq(documentAssignments.subject, sourceAssignment.subject))).limit(1);
      const assignmentValues = { usageType: sourceAssignment.usageType || "教材檢索", visibility: sourceAssignment.visibility || "members", aiSearchEnabled: sourceAssignment.aiSearchEnabled !== false, sortOrder: sourceAssignment.sortOrder || 0, updatedAt: new Date() };
      if (assignment) await db.update(documentAssignments).set(assignmentValues).where(eq(documentAssignments.id, assignment.id));
      else await db.insert(documentAssignments).values({ documentId: documentId!, examCategory: sourceAssignment.examCategory, subject: sourceAssignment.subject || "綜合", ...assignmentValues });
    }
    return Response.json({ status: existing ? "updated" : "created", documentId, fileName: sourceDocument.fileName, bytes: bytes.byteLength });
  }
  if (body.action === "scan") {
    const rows = await db.select({ id: documents.id, fileName: documents.fileName, storageKey: documents.storageKey }).from(documents);
    const missing: typeof rows = [];
    let existing = 0;
    for (let offset = 0; offset < rows.length; offset += 20) {
      const checks = await Promise.all(rows.slice(offset, offset + 20).map(async (row) => ({ row, found: Boolean(await env.BUCKET.head(row.storageKey)) })));
      for (const check of checks) check.found ? existing += 1 : missing.push(check.row);
    }
    return Response.json({ total: rows.length, existing, missing }, { headers: { "Cache-Control": "no-store" } });
  }
  const documentId = Number(body.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "文件編號不正確" }, { status: 400 });
  const [document] = await db.select({ id: documents.id, fileName: documents.fileName, storageKey: documents.storageKey, contentType: documents.contentType })
    .from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) return Response.json({ error: "找不到這份文件" }, { status: 404 });
  if (body.action === "restore") {
    if (await env.BUCKET.head(document.storageKey)) return Response.json({ status: "skipped", reason: "R2 已存在", document });
    if (!validConfig(body.config || {})) return Response.json({ error: "請匯入 Sites 同步設定" }, { status: 400 });
    const sourceUrl = new URL("/api/admin/cloudflare-source", sourceOrigin(body.config!));
    sourceUrl.searchParams.set("fileName", document.fileName);
    const source = await fetch(sourceUrl, { headers: { Authorization: `Bearer ${body.config!.token}` } });
    if (!source.ok) {
      const message = await source.json().catch(() => ({})) as { error?: string };
      return Response.json({ error: message.error || `Sites 下載失敗（${source.status}）` }, { status: 502 });
    }
    const bytes = await source.arrayBuffer();
    await env.BUCKET.put(document.storageKey, bytes, { httpMetadata: { contentType: source.headers.get("content-type") || document.contentType || "application/octet-stream" }, customMetadata: { source: "sites-missing-file-sync", fileName: document.fileName } });
    return Response.json({ status: "restored", bytes: bytes.byteLength, document });
  }
  if (body.action === "index") return buildFineIndexStep(document.id, { restart: Boolean(body.restart), forceReset: Boolean(body.restart) });
  return Response.json({ error: "不支援的同步動作" }, { status: 400 });
}
