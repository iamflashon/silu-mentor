import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { pengliStudyArtifacts, pengliStudyAudioSegments } from "../../../../../../db/schema";
import { requireMember } from "../../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({
    id: pengliStudyArtifacts.id,
    tool: pengliStudyArtifacts.tool,
    topic: pengliStudyArtifacts.topic,
    content: pengliStudyArtifacts.content,
    sourceLabel: pengliStudyArtifacts.sourceLabel,
    audioStorageKey: pengliStudyArtifacts.audioStorageKey,
    updatedAt: pengliStudyArtifacts.updatedAt,
  }).from(pengliStudyArtifacts).where(and(
    eq(pengliStudyArtifacts.status, "active"),
    eq(pengliStudyArtifacts.reviewStatus, "published"),
  )).orderBy(desc(pengliStudyArtifacts.updatedAt)).limit(100);
  const audioIds = rows.filter((row) => row.tool === "audio").map((row) => row.id);
  const segments = audioIds.length ? await auth.db.select().from(pengliStudyAudioSegments).where(inArray(pengliStudyAudioSegments.artifactId, audioIds)).orderBy(asc(pengliStudyAudioSegments.position)) : [];
  return Response.json({ rows: rows.filter((row) => row.tool !== "audio" || segments.some((segment) => segment.artifactId === row.id && segment.audioStorageKey)).map(({ audioStorageKey, ...row }) => ({ ...row, audioUrl: audioStorageKey ? `/api/teachers/pengli/study-room/audio?id=${row.id}` : null, audioSegments: segments.filter((segment) => segment.artifactId === row.id && segment.audioStorageKey).map((segment) => ({ id: segment.id, title: segment.title, audioUrl: `/api/teachers/pengli/study-room/audio?segmentId=${segment.id}` })) })) });
}
