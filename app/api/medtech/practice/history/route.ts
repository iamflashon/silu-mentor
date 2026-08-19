import { and, eq, inArray } from "drizzle-orm";
import { medtechPracticeSessions } from "../../../../../db/schema";
import { requireMedtechDevice } from "../../../../../lib/member-auth";

export async function DELETE(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { sessionIds?: unknown };
  const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100) : [];
  if (!sessionIds.length) return Response.json({ error: "請先選取要刪除的學習紀錄。" }, { status: 400 });
  const deleted = await auth.db.delete(medtechPracticeSessions).where(and(eq(medtechPracticeSessions.userKey, auth.userKey), inArray(medtechPracticeSessions.id, sessionIds))).returning({ id: medtechPracticeSessions.id });
  return Response.json({ deleted: deleted.length });
}
