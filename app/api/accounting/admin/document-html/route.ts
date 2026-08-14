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
  const object = await env.BUCKET.get(doc.storageKey);
  if (!object) return new Response("找不到原始 Word 檔", { status: 404 });
  try {
    const html = docxToHtml(await object.arrayBuffer(), `/api/accounting/admin/document-asset?id=${id}&asset=`);
    const fileName = `${doc.fileName.replace(/\.docx$/i, "")}.html`;
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
