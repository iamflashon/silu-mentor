import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { verifySitesCloudflareSyncToken } from "../../../../lib/sites-cloudflare-sync-token";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("token")?.trim() || "";
  if (!bearer || !await verifySitesCloudflareSyncToken(bearer)) return Response.json({ error: "同步設定已失效，請回 Sites 後台重新下載" }, { status: 401 });
  const fileName = url.searchParams.get("fileName")?.trim() || "";
  if (!fileName) return Response.json({ error: "缺少文件名稱" }, { status: 400 });
  const db = await getDb("primary");
  const [document] = await db.select({ fileName: documents.fileName, storageKey: documents.storageKey, contentType: documents.contentType })
    .from(documents).where(eq(documents.fileName, fileName)).limit(1);
  if (!document) return Response.json({ error: "Sites 找不到同名文件" }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET?.get(document.storageKey);
  if (!object) return Response.json({ error: "Sites 文件紀錄存在，但原始檔也已遺失" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || document.contentType || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
