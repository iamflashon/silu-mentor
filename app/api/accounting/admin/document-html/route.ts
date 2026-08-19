import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { docxToHtml } from "../../../../../lib/docx-html";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAccountingAdmin(request); if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return new Response("缺少文件編號", { status: 400 });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.examCategory, "accounting"))).limit(1);
  if (!doc) return new Response("找不到中會原稿", { status: 404 });
  if (!/\.docx$/i.test(doc.fileName)) return new Response("目前只有 Word 原稿可轉成 HTML", { status: 415 });
  const { env } = await import("cloudflare:workers");
  let result: Record<string, unknown> = {};
  try { result = JSON.parse(doc.processingResultJson) as Record<string, unknown>; } catch { result = {}; }
  const variants = Array.isArray(result.sourceVariants)
    ? result.sourceVariants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).storageKey === "string"))
    : [];
  const saved = variants.find((item) => item.kind === "html");
  if (saved && typeof saved.storageKey === "string") {
    const cached = await env.BUCKET.get(saved.storageKey);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(saved.fileName ?? `${doc.fileName.replace(/\.docx$/i, "")}.html`))}`,
          "cache-control": "private, no-store",
          "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'",
        },
      });
    }
  }
  const object = await env.BUCKET.get(doc.storageKey);
  if (!object) return new Response("找不到原始 Word 檔", { status: 404 });
  try {
    const html = docxToHtml(await object.arrayBuffer(), `/api/accounting/admin/document-asset?id=${id}&asset=`);
    const fileName = `${doc.fileName.replace(/\.docx$/i, "")}.html`;
    const htmlKey = `documents/html-${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120)}`;
    await env.BUCKET.put(htmlKey, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sourceDocumentId: String(id), sourceStorageKey: doc.storageKey, originalName: fileName },
    });
    const nextVariants = variants.filter((item) => item.kind !== "html");
    nextVariants.push({ kind: "html", storageKey: htmlKey, fileName, contentType: "text/html", sizeBytes: new TextEncoder().encode(html).byteLength, createdAt: new Date().toISOString(), sourceStorageKey: doc.storageKey });
    await db.update(documents).set({ processingResultJson: JSON.stringify({ ...result, sourceVariants: nextVariants }), processingMessage: "Word 原稿已建立並保存 HTML 對照稿；下次直接使用已保存版本" }).where(eq(documents.id, id));
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Word 轉換 HTML 失敗", { status: 422 });
  }
}
