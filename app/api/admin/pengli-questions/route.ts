import { desc, eq } from "drizzle-orm";
import { members, pengliTeacherQuestions } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ question: pengliTeacherQuestions, email: members.email, displayName: members.displayName })
    .from(pengliTeacherQuestions).leftJoin(members, eq(pengliTeacherQuestions.memberId, members.id))
    .orderBy(desc(pengliTeacherQuestions.updatedAt)).limit(200);
  return Response.json({ rows });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; teacherReply?: string };
  const id = Number(body.id || 0), teacherReply = String(body.teacherReply || "").trim().slice(0, 8000);
  if (!id || !teacherReply) return Response.json({ error: "請輸入老師回覆。" }, { status: 400 });
  await auth.db.update(pengliTeacherQuestions).set({ teacherReply, status: "answered", teacherRepliedAt: new Date(), studentReadAt: null, updatedAt: new Date() }).where(eq(pengliTeacherQuestions.id, id));
  return Response.json({ ok: true });
}
