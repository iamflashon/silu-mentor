import { and, eq, desc } from "drizzle-orm";
import { examQuestions, medtechPointLedger } from "../../../../db/schema";
import { requireMedtechDevice, requireMedtechMember } from "../../../../lib/member-auth";
import { consumeMedtechFeature, getOrCreateMedtechUsage, medtechUserKey, MEDTECH_AUDIO_ACCESS_HOURS, MEDTECH_AUDIO_TRIAL_LIMIT, spendMedtechPoints } from "../../../../lib/medtech-usage";

export async function GET(request: Request) {
  // 餘額查詢不會消耗內容權限；即使裝置達到上限，也要能在導覽列看到目前點數。
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const db = auth.db;
  const usage = await getOrCreateMedtechUsage(db, auth.userKey);
  const history = await db.select().from(medtechPointLedger).where(eq(medtechPointLedger.userKey, usage.userKey)).orderBy(desc(medtechPointLedger.createdAt)).limit(50);
  return Response.json({ audioTrialLimit: MEDTECH_AUDIO_TRIAL_LIMIT, audioUsed: 0, audioRemaining: 0, aiCredits: usage.aiCredits, points: usage.aiCredits, history });
}

export async function POST(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { action?: string; questionId?: number; useCredit?: boolean };
  const action = String(body.action || "");
  const db = auth.db;
  const userKey = auth.userKey || medtechUserKey(request);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (action === "audioTrial") return Response.json({ error: "語音完整解析改為每次扣 1 點，請先購買點數。", code: "POINTS_REQUIRED", creditCost: 1, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
  if (action === "audioComplete") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
    const feature = await consumeMedtechFeature(db, usage, { action: "audio_complete", description: "康情老師語音完整解析（24 小時使用權）", questionId, reuseWithinHours: MEDTECH_AUDIO_ACCESS_HOURS });
    if (!feature) return Response.json({ error: "點數已用完；語音完整解析每次扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", creditCost: 1, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    return Response.json({ allowed: true, access: feature.charged ? "credit" : "24h_pass", aiCredits: feature.usage.aiCredits, creditCost: feature.charged ? 1 : 0 });
  }
  if (action === "aiCredit") {
    if (usage.aiCredits <= 0) return Response.json({ error: "點數已用完；AI 追問每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    const updated = await spendMedtechPoints(db, usage, {
      action: "ai_followup",
      description: "AI 助教追問",
      questionId: Number.isInteger(Number(body.questionId)) ? Number(body.questionId) : undefined,
      sourceDetail: "提出新的 AI 追問，扣 1 點",
    });
    if (!updated) return Response.json({ error: "點數已用完；AI 追問每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    return Response.json({ allowed: true, aiCredits: updated.aiCredits });
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
    const feature = await consumeMedtechFeature(db, usage, { action: "complete_explanation", description: "完整文字解析", questionId, reuseWithinHours: 24 });
    if (!feature) return Response.json({ error: "點數已用完；完整解析每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    return Response.json({ allowed: true, fullExplanation, aiCredits: feature.usage.aiCredits, creditCost: feature.charged ? 1 : 0 });
  }
  return Response.json({ error: "不支援的用量操作" }, { status: 400 });
}
