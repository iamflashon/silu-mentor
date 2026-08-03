import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, learningResources } from "../../../../db/schema";

export async function GET(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("resourceId"));
    if (!Number.isInteger(id) || id < 1) return new Response("缺少書籍編號", { status: 400 });
    const db = await getDb();
    const [resource] = await db.select({ documentId: learningResources.documentId }).from(learningResources).where(eq(learningResources.id, id)).limit(1);
    if (!resource?.documentId) return new Response("這本書尚未綁定 PDF", { status: 404 });
    const [document] = await db.select().from(documents).where(eq(documents.id, resource.documentId)).limit(1);
    if (!document) return new Response("找不到書籍 PDF", { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(document.storageKey);
    if (!object) return new Response("書籍 PDF 原檔不存在", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": document.contentType || "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("書籍內容暫時無法讀取", { status: 503 });
  }
}
