import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { docxAsset } from "../../../../../lib/docx-html";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAccountingAdmin(request); if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  const asset = url.searchParams.get("asset") ?? "";
  if (!Number.isInteger(id) || id < 1 || !asset) return new Response("缺少圖片資訊", { status: 400 });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.examCategory, "accounting"))).limit(1);
  if (!doc || !/\.docx$/i.test(doc.fileName)) return new Response("找不到 Word 原稿", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(doc.storageKey);
  if (!object) return new Response("找不到原始 Word 檔", { status: 404 });
  const result = docxAsset(await object.arrayBuffer(), asset);
  if (!result) return new Response("找不到文件圖片", { status: 404 });
  return new Response(result.bytes, { headers: { "content-type": result.contentType, "cache-control": "private, max-age=300" } });
}
