import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources } from "../../../../db/schema";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, id)).limit(1);
  if (!resource?.coverStorageKey) return new Response("not found", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(resource.coverStorageKey);
  if (!object) return new Response("not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=3600" } });
}
