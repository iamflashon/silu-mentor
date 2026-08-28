import { and, desc, eq, or } from "drizzle-orm";
import { members, pengliTeacherQuestions } from "../../../../../db/schema";
import { requirePengliTeacher } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requirePengliTeacher(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ question: pengliTeacherQuestions, studentEmail: members.email, studentName: members.displayName })
    .from(pengliTeacherQuestions).leftJoin(members, eq(pengliTeacherQuestions.memberId, members.id))
    .where(and(eq(pengliTeacherQuestions.assignedTeacherId, auth.member.id), or(eq(pengliTeacherQuestions.status, "pending_teacher"), eq(pengliTeacherQuestions.status, "answered"))))
    .orderBy(desc(pengliTeacherQuestions.updatedAt)).limit(200);
  return Response.json({ rows, pendingCount: rows.filter((row) => row.question.status === "pending_teacher").length });
}

export async function PATCH(request: Request) {
  const auth = await requirePengliTeacher(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; teacherReply?: string };
  const id = Number(body.id || 0), teacherReply = String(body.teacherReply || "").trim().slice(0, 8000);
  if (!id || !teacherReply) return Response.json({ error: "請先輸入老師回覆。" }, { status: 400 });
  const [question] = await auth.db.select({ id: pengliTeacherQuestions.id }).from(pengliTeacherQuestions)
    .where(and(eq(pengliTeacherQuestions.id, id), eq(pengliTeacherQuestions.assignedTeacherId, auth.member.id), eq(pengliTeacherQuestions.status, "pending_teacher"))).limit(1);
  if (!question) return Response.json({ error: "找不到分派給你的待回答疑問。" }, { status: 404 });
  const now = new Date();
  await auth.db.update(pengliTeacherQuestions).set({ teacherReply, status: "answered", teacherRepliedAt: now, studentReadAt: null, updatedAt: now }).where(eq(pengliTeacherQuestions.id, id));
  return Response.json({ ok: true });
}
