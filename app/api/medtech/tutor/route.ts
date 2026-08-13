import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";

type Turn = { role: "student" | "mentor"; text: string };

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; level?: string; messages?: Turn[] };
    const messages = (body.messages ?? []).filter((item) => item && ["student", "mentor"].includes(item.role) && typeof item.text === "string").slice(-10);
    const latest = [...messages].reverse().find((item) => item.role === "student")?.text.trim();
    if (!latest) return Response.json({ error: "請先輸入想了解的問題。" }, { status: 400 });
    const db = await getDb();
    const questionId = Number(body.questionId);
    const [question] = Number.isInteger(questionId) ? await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examCategory, "medtech"), eq(examQuestions.status, "published"))).limit(1) : [];
    if (!question) return Response.json({ error: "找不到這道醫檢師題目，請重新抽題。" }, { status: 404 });
    if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定。" }, { status: 503 });
    const options = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
    const level = ["入門", "進階", "考前衝刺"].includes(String(body.level)) ? String(body.level) : "入門";
    const evidence = `【醫檢師題庫資料】\n題目：${question.stem}\n選項：${Object.entries(options).map(([key, value]) => `${key}. ${value}`).join("\n")}\n教材答案：${question.correctAnswer || "未提供"}\n教材原稿解析：${question.explanation?.trim() || "原稿未附文字解析"}\n題源：${question.answerSource || "臨床病毒學（下）"}`;
    const conversation = messages.map((item) => `${item.role === "student" ? "學生" : "醫檢 AI 助教"}：${item.text.slice(0, 1800)}`).join("\n\n");
    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是臺灣醫事檢驗師國考的 AI 學習助教，學生程度為「${level}」。你只能討論醫事檢驗、臨床病毒學及所附題庫資料，絕不可引用或混入司律、法律教材。以繁體中文教學。先回應學生真正的疑問，再用必要的基礎概念說明；比較選項時逐項指出判斷關鍵。教材答案是核對基準。若原稿沒有文字解析，必須明示「以下為 AI 補充說明」，不可假稱教材原文。若學生尚未要求答案，可先用一個提示或追問引導；若明確要求答案、解析或比較選項，就直接完整回答。不要捏造頁碼、文獻或教材內容。結尾提出一個簡短的理解確認問題。只輸出純文字，禁止使用 Markdown 標題符號、星號粗體、反引號、表格或表格分隔線；選項比較請用「A：內容」逐行呈現。`,
      input: `${evidence}\n\n【本次對話】\n${conversation}`,
      max_output_tokens: 1100,
    }) }) as Record<string, unknown>;
    const reply = outputText(payload);
    if (!reply) return Response.json({ error: "AI 暫時沒有完成回答，請再試一次。" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens || 0), outputTokens = Number(usage.output_tokens || 0), cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens });
    await db.insert(usageLogs).values({ model, source: "醫檢 AI 學習", inputTokens, outputTokens, cachedTokens, estimatedCostUsdMicros });
    return Response.json({ reply, source: question.explanation?.trim() ? "教材答案與原稿解析" : "教材答案＋AI 補充", usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "醫檢 AI 回答失敗" }, { status: 500 });
  }
}
