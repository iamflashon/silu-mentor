import { and, eq } from "drizzle-orm";
import { pengliStudyArtifacts, pengliStudyAudioSegments } from "../../../../../../db/schema";
import { requireMember } from "../../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const segmentId = Number(new URL(request.url).searchParams.get("segmentId"));
  if (Number.isInteger(segmentId) && segmentId > 0) {
    const [segment] = await auth.db.select().from(pengliStudyAudioSegments).where(eq(pengliStudyAudioSegments.id, segmentId)).limit(1);
    if (!segment?.audioStorageKey) return new Response("Not found", { status: 404 });
    const [parent] = await auth.db.select().from(pengliStudyArtifacts).where(and(eq(pengliStudyArtifacts.id, segment.artifactId), eq(pengliStudyArtifacts.tool, "audio"), eq(pengliStudyArtifacts.status, "active"), eq(pengliStudyArtifacts.reviewStatus, "published"))).limit(1);
    if (!parent) return new Response("Not found", { status: 404 });
    const { env } = await import("cloudflare:workers"); const object = await env.BUCKET?.get(segment.audioStorageKey);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("content-type", segment.audioContentType || "audio/mpeg"); headers.set("cache-control", "private, max-age=3600");
    return new Response(object.body, { headers });
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  const [artifact] = await auth.db.select().from(pengliStudyArtifacts).where(and(eq(pengliStudyArtifacts.id, id), eq(pengliStudyArtifacts.tool, "audio"), eq(pengliStudyArtifacts.status, "active"), eq(pengliStudyArtifacts.reviewStatus, "published"))).limit(1);
  if (!artifact?.audioStorageKey) return new Response("Not found", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET?.get(artifact.audioStorageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", artifact.audioContentType || "audio/mpeg");
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
