import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions, medtechUsage } from "../../../../db/schema";
import { getOrCreateMedtechUsage, medtechUserKey, MEDTECH_AUDIO_TRIAL_LIMIT } from "../../../../lib/medtech-usage";

export async function GET(request: Request) {
  const db = await getDb();
  const usage = await getOrCreateMedtechUsage(db, medtechUserKey(request));
  return Response.json({ audioTrialLimit: MEDTECH_AUDIO_TRIAL_LIMIT, audioUsed: 0, audioRemaining: 0, aiCredits: usage.aiCredits });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; questionId?: number; useCredit?: boolean };
  const action = String(body.action || "");
  const db = await getDb();
  const userKey = medtechUserKey(request);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (action === "audioTrial") return Response.json({ error: "語音完整解析改為每次扣 1 點，請先購買點數。", code: "POINTS_REQUIRED", creditCost: 1, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
  if (action === "audioComplete") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
    if (usage.aiCredits <= 0) return Response.json({ error: "點數已用完；語音完整解析每次扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", creditCost: 1, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    const nextCredits = usage.aiCredits - 1;
    await db.update(medtechUsage).set({ aiCredits: nextCredits, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id));
    return Response.json({ allowed: true, access: "credit", aiCredits: nextCredits, creditCost: 1 });
  }
  if (action === "aiCredit") {
    if (usage.aiCredits <= 0) return Response.json({ error: "點數已用完；AI 追問每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    const next = usage.aiCredits - 1;
    await db.update(medtechUsage).set({ aiCredits: next, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id));
    return Response.json({ allowed: true, aiCredits: next });
  }
  if (action === "completeExplanation") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
    const [question] = await db.select({
      id: examQuestions.id,
      teacherCompleteExplanation: examQuestions.teacherCompleteExplanation,
      completeExplanation: examQuestions.completeExplanation,
      aiCompleteExplanation: examQuestions.aiCompleteExplanation,
      simulatedCompleteExplanation: examQuestions.simulatedCompleteExplanation,
    }).from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examCategory, "medtech"), eq(examQuestions.status, "published"))).limit(1);
    if (!question) return Response.json({ error: "找不到已發布的醫檢題目" }, { status: 404 });
    const fullExplanation = question.teacherCompleteExplanation || question.completeExplanation || question.aiCompleteExplanation || question.simulatedCompleteExplanation || "";
    if (!fullExplanation.trim()) return Response.json({ error: "本題尚未建立完整解析" }, { status: 404 });
    if (usage.aiCredits <= 0) return Response.json({ error: "點數已用完；完整解析每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    const next = usage.aiCredits - 1;
    await db.update(medtechUsage).set({ aiCredits: next, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id));
    return Response.json({ allowed: true, fullExplanation, aiCredits: next });
  }
  return Response.json({ error: "不支援的用量操作" }, { status: 400 });
}
