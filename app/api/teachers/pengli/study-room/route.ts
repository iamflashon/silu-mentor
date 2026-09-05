import { desc, eq } from "drizzle-orm";
import { pengliStudyRuns } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({
    id: pengliStudyRuns.id,
    tool: pengliStudyRuns.tool,
    topic: pengliStudyRuns.topic,
    outputText: pengliStudyRuns.outputText,
    sourceLabel: pengliStudyRuns.sourceLabel,
    cacheHit: pengliStudyRuns.cacheHit,
    createdAt: pengliStudyRuns.createdAt,
  }).from(pengliStudyRuns).where(eq(pengliStudyRuns.memberId, auth.member.id)).orderBy(desc(pengliStudyRuns.createdAt)).limit(50);
  return Response.json({ rows });
}
