import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { members, pengliTeacherQuestions } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ question: pengliTeacherQuestions, email: members.email, displayName: members.displayName })
    .from(pengliTeacherQuestions).leftJoin(members, eq(pengliTeacherQuestions.memberId, members.id))
    .where(ne(pengliTeacherQuestions.status, "verified"))
    .orderBy(desc(pengliTeacherQuestions.updatedAt)).limit(200);
  const teacherCandidates = await auth.db.select({ id: members.id, email: members.email, displayName: members.displayName, role: members.role })
    .from(members).where(eq(members.status, "active")).orderBy(members.displayName);
  return Response.json({ rows, teacherCandidates });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; action?: "assign"; teacherId?: number };
  const id = Number(body.id || 0), teacherId = Number(body.teacherId || 0);
  if (!id || body.action !== "assign" || !teacherId) return Response.json({ error: "請選擇要轉交的老師。" }, { status: 400 });
  const [teacher] = await auth.db.select({ id: members.id, role: members.role }).from(members)
    .where(and(eq(members.id, teacherId), eq(members.status, "active"))).limit(1);
  if (!teacher) return Response.json({ error: "找不到這個啟用中的平台帳號。" }, { status: 404 });
  const [question] = await auth.db.select({ id: pengliTeacherQuestions.id }).from(pengliTeacherQuestions)
    .where(and(eq(pengliTeacherQuestions.id, id), or(eq(pengliTeacherQuestions.status, "pending_review"), and(eq(pengliTeacherQuestions.status, "pending_teacher"), isNull(pengliTeacherQuestions.assignedTeacherId))))).limit(1);
  if (!question) return Response.json({ error: "這筆疑問已處理或不在待確認狀態。" }, { status: 409 });
  const now = new Date();
  if (teacher.role !== "teacher") {
    await auth.db.update(members).set({ role: "teacher", updatedAt: now }).where(eq(members.id, teacherId));
  }
  await auth.db.update(pengliTeacherQuestions).set({ assignedTeacherId: teacherId, status: "pending_teacher", adminReviewedAt: now, assignedAt: now, updatedAt: now }).where(eq(pengliTeacherQuestions.id, id));
  return Response.json({ ok: true });
}
