import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions, medtechUsage } from "../../../../db/schema";
import { audioTrialIds, getOrCreateMedtechUsage, medtechUserKey, MEDTECH_AUDIO_TRIAL_LIMIT } from "../../../../lib/medtech-usage";

export async function GET(request: Request) {
  const db = await getDb();
  const usage = await getOrCreateMedtechUsage(db, medtechUserKey(request));
  const audioUsed = audioTrialIds(usage).length;
  return Response.json({ audioTrialLimit: MEDTECH_AUDIO_TRIAL_LIMIT, audioUsed, audioRemaining: Math.max(0, MEDTECH_AUDIO_TRIAL_LIMIT - audioUsed), aiCredits: usage.aiCredits });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; questionId?: number };
  const action = String(body.action || "");
  const db = await getDb();
  const userKey = medtechUserKey(request);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (action === "audioTrial") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
    const ids = audioTrialIds(usage);
    if (ids.includes(questionId)) return Response.json({ allowed: true, audioUsed: ids.length, audioRemaining: Math.max(0, MEDTECH_AUDIO_TRIAL_LIMIT - ids.length) });
    if (ids.length >= MEDTECH_AUDIO_TRIAL_LIMIT) return Response.json({ error: "免費語音試聽已用完，請先訂閱方案。", code: "AUDIO_TRIAL_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=audio-trial" }, { status: 402 });
    const nextIds = [...ids, questionId];
    await db.update(medtechUsage).set({ audioTrialQuestionIdsJson: JSON.stringify(nextIds), updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id));
    return Response.json({ allowed: true, audioUsed: nextIds.length, audioRemaining: Math.max(0, MEDTECH_AUDIO_TRIAL_LIMIT - nextIds.length) });
  }
  if (action === "aiCredit") {
    if (usage.aiCredits <= 0) return Response.json({ error: "AI 互動點數已用完，請購買點數或訂閱方案。", code: "AI_CREDITS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=ai-credits" }, { status: 402 });
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
    if (usage.aiCredits <= 0) return Response.json({ error: "AI 點數已用完，請購買點數或訂閱方案。", code: "AI_CREDITS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=ai-credits" }, { status: 402 });
    const next = usage.aiCredits - 1;
    await db.update(medtechUsage).set({ aiCredits: next, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id));
    return Response.json({ allowed: true, fullExplanation, aiCredits: next });
  }
  return Response.json({ error: "不支援的用量操作" }, { status: 400 });
}
