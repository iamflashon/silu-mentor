import { eq, and } from "drizzle-orm";
import { examQuestions, medtechAiExplanationCache, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { getOrCreateMedtechUsage, spendMedtechPoints } from "../../../../lib/medtech-usage";
import { requireMedtechDevice } from "../../../../lib/member-auth";

type Turn = { role: "student" | "mentor"; text: string };

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

export async function POST(request: Request) {
  try {
    const auth = await requireMedtechDevice(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { questionId?: number; level?: string; messages?: Turn[]; mode?: "hint" | "compare" | "answer" | "followup"; selectedAnswer?: string };
    const messages = (body.messages ?? []).filter((item) => item && ["student", "mentor"].includes(item.role) && typeof item.text === "string").slice(-10);
    const latest = [...messages].reverse().find((item) => item.role === "student")?.text.trim();
    if (!latest) return Response.json({ error: "請先輸入想了解的問題。" }, { status: 400 });
    const db = auth.db;
    const questionId = Number(body.questionId);
    const [question] = Number.isInteger(questionId) ? await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examCategory, "medtech"), eq(examQuestions.status, "published"))).limit(1) : [];
    if (!question) return Response.json({ error: "找不到這道醫檢師題目，請重新抽題。" }, { status: 404 });
    if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定。" }, { status: 503 });
    const level = ["入門", "進階", "考前衝刺"].includes(String(body.level)) ? String(body.level) : "入門";
    const selectedAnswer = String(body.selectedAnswer ?? latest.match(/^我選\s*([A-D])/iu)?.[1] ?? "").toUpperCase();
    const mode = body.mode ?? (selectedAnswer ? "answer" : "followup");
    const initialReview = mode === "answer" || (messages.filter((item) => item.role === "student").length === 1 && Boolean(selectedAnswer));
    const usageState = await getOrCreateMedtechUsage(db, auth.userKey);
    const cacheMode = mode === "hint" || mode === "compare" || initialReview;
    if (!cacheMode && usageState.aiCredits <= 0) return Response.json({ error: "點數已用完；AI 追問每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    if (mode === "compare" && !selectedAnswer) return Response.json({ error: "請先選擇答案，再比較選項。" }, { status: 400 });
    const cacheKey = mode === "hint"
      ? `medtech:hint:${question.id}:${level}`
      : mode === "compare"
        ? `medtech:compare:${question.id}:${selectedAnswer}:${level}`
        : `medtech:initial:${question.id}:${selectedAnswer}:${level}`;
    if (cacheMode) {
      const [cached] = await db.select().from(medtechAiExplanationCache).where(eq(medtechAiExplanationCache.cacheKey, cacheKey)).limit(1);
      if (cached) {
        await db.update(medtechAiExplanationCache).set({ lastUsedAt: new Date() }).where(eq(medtechAiExplanationCache.id, cached.id));
        return Response.json({ reply: cached.reply, source: mode === "hint" ? "判斷提示（免費快取）" : mode === "compare" ? "比較選項（免費快取）" : "答題結果（免費快取）", creditsRemaining: usageState.aiCredits, usage: { model: "cache", inputTokens: 0, outputTokens: 0, cachedTokens: 0, durationMs: 0, estimatedCostUsd: 0 } });
      }
    }
    const options = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
    const activeAnswer = question.teacherAnswer || question.correctAnswer || question.simulatedAnswer || "未提供";
    const evidence = `【醫檢師題庫資料】\n題目：${question.stem}\n選項：${Object.entries(options).map(([key, value]) => `${key}. ${value}`).join("\n")}\n教材答案：${activeAnswer}\n教材原稿解析：${question.explanation?.trim() || "原稿未附文字解析"}\n題源：${question.answerSource || "臨床病毒學（下）"}`;
    const conversation = messages.map((item) => `${item.role === "student" ? "學生" : "醫檢 AI 助教"}：${item.text.slice(0, 1800)}`).join("\n\n");
    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const instructions = mode === "hint"
      ? "你是臺灣醫事檢驗師國考的學習助教。這是學生尚未作答前索取的免費提示。只提供一個能幫助判斷的核心線索，不公布答案、不逐項解析、不反問學生、不要求學生回覆，不使用 Markdown，控制在 40 至 80 字。"
      : mode === "compare"
        ? "你是臺灣醫事檢驗師國考的學習助教。學生已經選完答案，現在只需要『比較選項』的簡答。先用一句話指出正確答案與學生選項的關係，再用 A、B、C、D 各一行說明判斷關鍵；每個選項一句話即可，控制在 100 至 180 字。不反問、不延伸教學、不使用 Markdown 標題、表格或星號。"
        : initialReview
          ? "你是臺灣醫事檢驗師國考的 AI 學習助教。這是學生第一次作答後的免費回饋，只回答學生選哪個，以及答對或答錯；最後提醒學生可按『比較選項』查看簡答。不要逐項解析、不要公布完整解析、不要提出追問，不使用 Markdown，控制在 30 至 60 字。"
          : `你是臺灣醫事檢驗師國考的 AI 學習助教，學生程度為「${level}」。你只能討論醫事檢驗、臨床病毒學及所附題庫資料，絕不可引用或混入司律、法律教材。以繁體中文教學。先回應學生真正的疑問，再用必要的基礎概念說明；比較選項時逐項指出判斷關鍵。教材答案是核對基準。若原稿沒有文字解析，必須明示「以下為 AI 補充說明」，不可假稱教材原文。若學生尚未要求答案，可先用一個提示或追問引導；若明確要求答案、解析或比較選項，就直接完整回答。不要捏造頁碼、文獻或教材內容。結尾不要提出問題。只輸出純文字，禁止使用 Markdown 標題符號、星號粗體、反引號、表格或表格分隔線；選項比較請用「A：內容」逐行呈現。`;
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions,
      input: `${evidence}\n\n【本次對話】\n${conversation}`,
      max_output_tokens: mode === "hint" ? 220 : mode === "compare" ? 420 : initialReview ? 220 : 1100,
    }) }) as Record<string, unknown>;
    const reply = outputText(payload);
    if (!reply) return Response.json({ error: "AI 暫時沒有完成回答，請再試一次。" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens || 0), outputTokens = Number(usage.output_tokens || 0), cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens });
    if (cacheMode) {
      await db.insert(medtechAiExplanationCache).values({ cacheKey, questionId: question.id, answer: selectedAnswer, level, reply }).onConflictDoNothing();
      await db.insert(usageLogs).values({ model, source: mode === "hint" ? "醫檢 AI 判斷提示（免費快取）" : mode === "compare" ? "醫檢 AI 比較選項（免費快取）" : "醫檢 AI 答題結果（免費快取）", inputTokens, outputTokens, cachedTokens, estimatedCostUsdMicros });
      return Response.json({ reply, source: mode === "hint" ? "判斷提示（免費，已快取）" : mode === "compare" ? "比較選項（免費，已快取）" : "答題結果（免費，已快取）", creditsRemaining: usageState.aiCredits, usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: 0 } });
    }
    const updatedUsage = await spendMedtechPoints(db, usageState, {
      action: "ai_followup",
      description: "AI 助教追問",
      questionId: question.id,
      sourceDetail: "提出新的 AI 追問，扣 1 點",
    });
    if (!updatedUsage) return Response.json({ error: "點數已用完；AI 追問每題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    await db.insert(usageLogs).values({ model, source: "醫檢 AI 學習", inputTokens, outputTokens, cachedTokens, estimatedCostUsdMicros });
    return Response.json({ reply, source: question.explanation?.trim() ? "教材答案與原稿解析" : "教材答案＋AI 補充", creditsRemaining: updatedUsage.aiCredits, usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "醫檢 AI 回答失敗" }, { status: 500 });
  }
}
