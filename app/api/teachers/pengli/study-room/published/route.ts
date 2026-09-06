import { and, desc, eq } from "drizzle-orm";
import { pengliStudyArtifacts } from "../../../../../../db/schema";
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
  return Response.json({ rows: rows.filter((row) => row.tool !== "audio" || row.audioStorageKey).map(({ audioStorageKey, ...row }) => ({ ...row, audioUrl: audioStorageKey ? `/api/teachers/pengli/study-room/audio?id=${row.id}` : null })) });
}
