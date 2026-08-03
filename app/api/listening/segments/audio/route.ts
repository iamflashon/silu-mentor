import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { listeningAudioSegments } from "../../../../../db/schema";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id")); const db = await getDb();
  const [segment] = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.id, id)).limit(1);
  if (!segment) return new Response("Not found", { status: 404 });
  const { env } = await import("cloudflare:workers"); const object = await env.BUCKET.get(segment.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": segment.contentType, "cache-control": "private, max-age=3600" } });
}
