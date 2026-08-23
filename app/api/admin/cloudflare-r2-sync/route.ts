import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { buildFineIndexStep } from "../../documents/fine-index/route";

type SyncConfig = { sitesUrl?: string; token?: string };

function validConfig(config: SyncConfig) {
  try {
    const url = new URL(String(config.sitesUrl || ""));
    return url.protocol === "https:" && Boolean(config.token?.trim());
  } catch { return false; }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { action?: string; documentId?: number; config?: SyncConfig; restart?: boolean };
  const db = await getDb("primary");
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "Cloudflare R2 尚未綁定" }, { status: 503 });
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
    const sourceUrl = new URL("/api/admin/cloudflare-source", body.config!.sitesUrl);
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
