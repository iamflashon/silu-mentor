import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { noteAttachments } from "../../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return new Response("not found", { status: 404 });
  const db = await getDb();
  const [attachment] = await db.select().from(noteAttachments).where(and(eq(noteAttachments.id, id), eq(noteAttachments.userKey, userKey(request)))).limit(1);
  if (!attachment) return new Response("not found", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(attachment.storageKey);
  if (!object) return new Response("not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? attachment.contentType, "cache-control": "private, max-age=86400" } });
}
