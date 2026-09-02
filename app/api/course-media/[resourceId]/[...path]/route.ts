import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { learningResources } from "../../../../../db/schema";
import { readLocalNodeJobs } from "../../../../../lib/local-node-jobs";

export async function GET(_request: Request, context: { params: Promise<{ resourceId: string; path: string[] }> }) {
  const { resourceId: rawId, path } = await context.params;
  const resourceId = Number(rawId);
  const mediaPath = Array.isArray(path) ? path.join("/") : "";
  if (!resourceId || !/^(?:index\.m3u8|poster\.jpg|transcript\.srt|subtitles\.vtt|metadata\.json|segment-\d{5}\.ts)$/i.test(mediaPath)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [resource] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return new Response("Not found", { status: 404 });
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.resourceId === resourceId && item.kind === "transcode_video" && item.status === "completed" && item.mediaPrefix);
  if (!job?.mediaPrefix) return new Response("Media not ready", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(`${job.mediaPrefix}/${mediaPath}`);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", mediaPath.endsWith(".m3u8") ? "private, no-store" : "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
