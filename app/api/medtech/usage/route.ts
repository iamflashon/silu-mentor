import { and, eq, desc } from "drizzle-orm";
import { examQuestions, medtechPointLedger } from "../../../../db/schema";
import {
  requireMedtechDevice,
  requireMedtechMember,
} from "../../../../lib/member-auth";
import {
  consumeMedtechFeature,
  getOrCreateMedtechUsage,
  medtechUserKey,
  MEDTECH_AUDIO_ACCESS_HOURS,
  MEDTECH_AUDIO_TRIAL_LIMIT,
  spendMedtechPoints,
} from "../../../../lib/medtech-usage";

export async function GET(request: Request) {
  // 餘額查詢不會消耗內容權限；即使裝置達到上限，也要能在導覽列看到目前點數。
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const db = auth.db;
  const usage = await getOrCreateMedtechUsage(db, auth.userKey);
  const history = await db
    .select()
    .from(medtechPointLedger)
    .where(eq(medtechPointLedger.userKey, usage.userKey))
    .orderBy(desc(medtechPointLedger.createdAt))
    .limit(50);
  return Response.json({
    audioTrialLimit: MEDTECH_AUDIO_TRIAL_LIMIT,
    audioUsed: 0,
    audioRemaining: 0,
    aiCredits: usage.aiCredits,
    points: usage.aiCredits,
    history,
  });
}

export async function POST(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as {
    action?: string;
    questionId?: number;
    useCredit?: boolean;
  };
  const action = String(body.action || "");
  const db = auth.db;
  const userKey = auth.userKey || medtechUserKey(request);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (action === "audioTrial")
    return Response.json({ allowed: true, access: "included", creditCost: 0 });
  if (action === "audioComplete") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1)
      return Response.json({ error: "缺少題目編號" }, { status: 400 });
    return Response.json({
      allowed: true,
      access: "included",
      aiCredits: usage.aiCredits,
      creditCost: 0,
    });
  }
  if (action === "aiCredit") {
    return Response.json(
      { error: "即時 AI 追問目前暫停開放。", code: "LIVE_AI_DISABLED" },
      { status: 503 },
    );
  }
  if (action === "completeExplanation") {
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId < 1)
      return Response.json({ error: "缺少題目編號" }, { status: 400 });
    const [question] = await db
      .select({
        id: examQuestions.id,
        teacherCompleteExplanation: examQuestions.teacherCompleteExplanation,
        completeExplanation: examQuestions.completeExplanation,
        aiCompleteExplanation: examQuestions.aiCompleteExplanation,
        simulatedCompleteExplanation:
          examQuestions.simulatedCompleteExplanation,
      })
      .from(examQuestions)
      .where(
        and(
          eq(examQuestions.id, questionId),
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.status, "published"),
        ),
      )
      .limit(1);
    if (!question)
      return Response.json(
        { error: "找不到已發布的醫檢題目" },
        { status: 404 },
      );
    const fullExplanation =
      question.teacherCompleteExplanation ||
      question.completeExplanation ||
      question.aiCompleteExplanation ||
      question.simulatedCompleteExplanation ||
      "";
    if (!fullExplanation.trim())
      return Response.json({ error: "本題尚未建立完整解析" }, { status: 404 });
    return Response.json({
      allowed: true,
      fullExplanation,
      aiCredits: usage.aiCredits,
      creditCost: 0,
    });
  }
  return Response.json({ error: "不支援的用量操作" }, { status: 400 });
}
