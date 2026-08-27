import { and, desc, eq, isNull } from "drizzle-orm";
import { pengliTeacherQuestions } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select().from(pengliTeacherQuestions)
    .where(eq(pengliTeacherQuestions.memberId, auth.member.id))
    .orderBy(desc(pengliTeacherQuestions.updatedAt)).limit(100);
  const unreadCount = rows.filter((row) => row.status === "answered" && !row.studentReadAt).length;
  return Response.json({ rows: rows.map((row) => ({ ...row, verificationSources: JSON.parse(row.verificationSourcesJson || "[]") })), unreadCount });
}

export async function PATCH(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; action?: "escalate" | "read" };
  const id = Number(body.id || 0);
  if (!id) return Response.json({ error: "找不到疑問單。" }, { status: 400 });
  const [row] = await auth.db.select().from(pengliTeacherQuestions).where(and(eq(pengliTeacherQuestions.id, id), eq(pengliTeacherQuestions.memberId, auth.member.id))).limit(1);
  if (!row) return Response.json({ error: "找不到疑問單。" }, { status: 404 });
  if (body.action === "escalate") {
    await auth.db.update(pengliTeacherQuestions).set({ status: "pending_teacher", updatedAt: new Date() }).where(eq(pengliTeacherQuestions.id, id));
  } else if (body.action === "read" && row.status === "answered") {
    await auth.db.update(pengliTeacherQuestions).set({ studentReadAt: new Date(), updatedAt: new Date() }).where(and(eq(pengliTeacherQuestions.id, id), isNull(pengliTeacherQuestions.studentReadAt)));
  }
  return Response.json({ ok: true });
}
