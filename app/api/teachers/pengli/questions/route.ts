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

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { messageKey?: unknown; conversationKey?: unknown; topic?: unknown; studentQuestion?: unknown; aiReply?: unknown; submissionKind?: unknown };
  const messageKey = String(body.messageKey ?? "").slice(0, 120);
  const studentQuestion = String(body.studentQuestion ?? "").trim().slice(0, 2000);
  if (!messageKey || !studentQuestion) return Response.json({ error: "找不到要轉交老師的問題。" }, { status: 400 });
  const [existing] = await auth.db.select({ id: pengliTeacherQuestions.id, status: pengliTeacherQuestions.status }).from(pengliTeacherQuestions)
    .where(and(eq(pengliTeacherQuestions.memberId, auth.member.id), eq(pengliTeacherQuestions.messageKey, messageKey))).limit(1);
  if (existing) {
    if (existing.status === "verified") await auth.db.update(pengliTeacherQuestions).set({ status: "pending_review", updatedAt: new Date() }).where(eq(pengliTeacherQuestions.id, existing.id));
    return Response.json({ ok: true, id: existing.id, duplicate: true });
  }
  const [row] = await auth.db.insert(pengliTeacherQuestions).values({
    memberId: auth.member.id,
    conversationKey: String(body.conversationKey ?? "").slice(0, 120),
    messageKey,
    topic: String(body.topic ?? "行政法").slice(0, 120),
    aiReply: String(body.aiReply ?? "未找到對應書頁").slice(0, 6000),
    studentQuestion,
    verificationResult: body.submissionKind === "ai-interpretation-question"
      ? "學生認為 AI 回覆可能有誤，想請老師說明 AI 為何如此解讀並提供正確觀點。"
      : "教材全文檢索未命中；依學生選擇直接轉請老師回答。",
    verificationSourcesJson: "[]",
    status: "pending_review",
  }).returning({ id: pengliTeacherQuestions.id });
  return Response.json({ ok: true, id: row.id });
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
    if (row.status !== "verified") return Response.json({ error: "這筆疑問已送出或已由老師處理。" }, { status: 409 });
    await auth.db.update(pengliTeacherQuestions).set({ status: "pending_review", assignedTeacherId: null, adminReviewedAt: null, assignedAt: null, updatedAt: new Date() }).where(eq(pengliTeacherQuestions.id, id));
  } else if (body.action === "read" && row.status === "answered") {
    await auth.db.update(pengliTeacherQuestions).set({ studentReadAt: new Date(), updatedAt: new Date() }).where(and(eq(pengliTeacherQuestions.id, id), isNull(pengliTeacherQuestions.studentReadAt)));
  }
  return Response.json({ ok: true });
}
