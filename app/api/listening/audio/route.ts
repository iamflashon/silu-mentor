import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { listeningSolutions } from "../../../../db/schema";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id")); const db = await getDb(); const [row] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.id, id)).limit(1);
  if (!row?.audioStorageKey) return new Response("Not found", { status: 404 }); const { env } = await import("cloudflare:workers"); const object = await env.BUCKET.get(row.audioStorageKey); if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "audio/mpeg", "cache-control": "public, max-age=3600" } });
}
