import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { examQuestions } from "../../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../../lib/member-auth";
import { sanitizeRichHtml } from "../../../../../../../lib/rich-html";

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; correctAnswer?: string; teacherNote?: string };
  const id = Number(body.id);
  const correctAnswer = String(body.correctAnswer ?? "").trim().toUpperCase();
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  if (!/^[A-D]$/.test(correctAnswer)) return Response.json({ error: "老師批改答案必須是 A、B、C 或 D" }, { status: 400 });
  const db = await getDb();
  const [question] = await db.select().from(examQuestions).where(and(
    eq(examQuestions.id, id),
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
  )).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢選擇題" }, { status: 404 });
  const aiAccuracy = question.simulatedAnswer ? (question.simulatedAnswer === correctAnswer ? "ai_correct" : "ai_incorrect") : "pending_review";
  const [updated] = await db.update(examQuestions).set({
    correctAnswer,
    answerStatus: "teacher_confirmed",
    simulatedAnswerStatus: aiAccuracy,
    simulatedTeacherNote: sanitizeRichHtml(String(body.teacherNote ?? "").trim()),
  }).where(eq(examQuestions.id, id)).returning();
  return Response.json({ item: updated, aiAccuracy });
}
