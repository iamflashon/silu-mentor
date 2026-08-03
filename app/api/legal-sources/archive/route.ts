import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { legalDataSources } from "../../../../db/schema";

export async function GET(request: Request) {
  const sourceKey = new URL(request.url).searchParams.get("sourceKey") ?? "";
  if (sourceKey !== "moj-regulations") return Response.json({ error: "不支援的法規資料來源" }, { status: 400 });
  try {
    const db = await getDb();
    const [source] = await db.select().from(legalDataSources).where(eq(legalDataSources.sourceKey, sourceKey)).limit(1);
    if (!source?.archiveStorageKey) return Response.json({ error: "尚未上傳全國法規 ZIP" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const archive = await env.BUCKET.get(source.archiveStorageKey);
    if (!archive?.body) return Response.json({ error: "找不到已上傳的全國法規 ZIP，請重新上傳" }, { status: 404 });
    const headers = new Headers({
      "content-type": archive.httpMetadata?.contentType || "application/zip",
      "content-disposition": 'attachment; filename="national-laws.zip"',
      "cache-control": "private, no-store",
    });
    if (archive.size) headers.set("content-length", String(archive.size));
    return new Response(archive.body, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "全國法規 ZIP 暫時無法讀取" }, { status: 503 });
  }
}
