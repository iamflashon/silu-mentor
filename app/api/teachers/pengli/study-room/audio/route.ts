import { and, eq } from "drizzle-orm";
import { pengliStudyArtifacts } from "../../../../../../db/schema";
import { requireMember } from "../../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
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
