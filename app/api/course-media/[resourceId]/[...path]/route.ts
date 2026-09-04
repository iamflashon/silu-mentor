import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { learningResources, members, posnerCourseEntitlements, posnerCourseProducts } from "../../../../../db/schema";
import { readLocalNodeJobs } from "../../../../../lib/local-node-jobs";
import { authenticatedEmail } from "../../../../../lib/member-auth";

function previewManifest(body: string, start: number, duration: number) {
  if (duration <= 0) return "#EXTM3U\n#EXT-X-ENDLIST\n";
  const lines = body.split(/\r?\n/), headers: string[] = [], selected: string[] = [];
  let elapsed = 0, sequence = 0, firstSequence = 0, started = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) firstSequence = Number(line.split(":")[1]) || 0;
    else if (line.startsWith("#EXT-X-") && !line.startsWith("#EXT-X-ENDLIST") && !line.startsWith("#EXTINF")) headers.push(line);
    if (!line.startsWith("#EXTINF:")) continue;
    const length = Number(line.slice(8).split(",")[0]) || 0;
    const uri = lines[index + 1] || "";
    if (elapsed + length > start && elapsed < start + duration) {
      if (!started) {
        selected.push("#EXTM3U", ...headers.filter((value) => !value.startsWith("#EXT-X-MEDIA-SEQUENCE:")), `#EXT-X-MEDIA-SEQUENCE:${firstSequence + sequence}`);
        started = true;
      }
      selected.push(line, uri);
    }
    elapsed += length; sequence += 1; index += 1;
  }
  return [...selected, "#EXT-X-ENDLIST", ""].join("\n");
}

function previewSegmentNames(body: string, start: number, duration: number) {
  const lines = body.split(/\r?\n/), allowed = new Set<string>();
  let elapsed = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXTINF:")) continue;
    const length = Number(lines[index].slice(8).split(",")[0]) || 0;
    const uri = (lines[index + 1] || "").trim();
    if (uri && elapsed + length > start && elapsed < start + duration) allowed.add(uri.split(/[?#]/)[0].split("/").at(-1) || "");
    elapsed += length; index += 1;
  }
  return allowed;
}

export async function GET(request: Request, context: { params: Promise<{ resourceId: string; path: string[] }> }) {
  const { resourceId: rawId, path } = await context.params;
  const resourceId = Number(rawId);
  const mediaPath = Array.isArray(path) ? path.join("/") : "";
  if (!resourceId || !/^(?:index\.m3u8|poster\.jpg|transcript\.srt|subtitles\.vtt|metadata\.json|segment-\d{5}\.ts)$/i.test(mediaPath)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [resource] = await db.select({ id: learningResources.id, accessType: learningResources.accessType }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return new Response("Not found", { status: 404 });
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.resourceId === resourceId && item.kind === "transcode_video" && item.status === "completed" && item.mediaPrefix);
  if (!job?.mediaPrefix) return new Response("Media not ready", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(`${job.mediaPrefix}/${mediaPath}`);
  if (!object) return new Response("Not found", { status: 404 });
  let entitled = false;
  let previewStart = 0;
  let previewDuration = 0;
  if (resource.accessType === "posner") {
    const [product] = await db.select({ start: posnerCourseProducts.previewStartSeconds, duration: posnerCourseProducts.previewDurationSeconds }).from(posnerCourseProducts).where(eq(posnerCourseProducts.resourceId, resourceId)).limit(1);
    previewStart = product?.start ?? 0;
    previewDuration = product?.duration ?? 300;
    const email = authenticatedEmail(request);
    if (email) {
      const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
      if (member) {
        const [access] = await db.select({ id: posnerCourseEntitlements.id }).from(posnerCourseEntitlements).where(and(eq(posnerCourseEntitlements.memberId, member.id), eq(posnerCourseEntitlements.resourceId, resourceId), eq(posnerCourseEntitlements.status, "active"), gt(posnerCourseEntitlements.expiresAt, new Date()))).limit(1);
        entitled = Boolean(access);
      }
    }
  } else {
    entitled = true;
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", mediaPath.endsWith(".m3u8") ? "private, no-store" : "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  if (mediaPath === "index.m3u8" && !entitled) {
    const manifest = await object.text();
    headers.set("content-type", "application/vnd.apple.mpegurl");
    return new Response(previewManifest(manifest, previewStart, previewDuration), { headers });
  }
  if (!entitled && mediaPath.startsWith("segment-")) {
    const playlist = await env.BUCKET.get(`${job.mediaPrefix}/index.m3u8`);
    if (!playlist || !previewSegmentNames(await playlist.text(), previewStart, previewDuration).has(mediaPath)) return new Response("Preview limit reached", { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (!entitled && /^(?:transcript\.srt|subtitles\.vtt)$/i.test(mediaPath)) return new Response("Purchase required", { status: 403, headers: { "cache-control": "no-store" } });
  return new Response(object.body, { headers });
}
