import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatComparisonRatings, chatComparisonResponses, chatComparisons, usageLogs } from "../../../db/schema";
import { getTeamoRouterBaseUrl, getTeamoRouterKey } from "../../../lib/openai";

type ModelKey = "sol" | "terra" | "sonnet" | "opus" | "gemini" | "deepseek" | "glm" | "kimi";
const contextType = "issue-spotting-arena-v1";
const models: Record<ModelKey, { label: string; vendor: string; id: string; input: number; output: number }> = {
  sol: { label: "Sol", vendor: "OpenAI", id: "gpt-5.6-sol", input: .525, output: 3.15 },
  terra: { label: "Terra", vendor: "OpenAI", id: "gpt-5.6-terra", input: .206, output: 1.24 },
  sonnet: { label: "Claude Sonnet 5", vendor: "Anthropic", id: "claude-sonnet-5", input: .356, output: 1.78 },
  opus: { label: "Claude Opus 5", vendor: "Anthropic", id: "claude-opus-5", input: .815, output: 4.08 },
  gemini: { label: "Gemini 3.6 Flash", vendor: "Google", id: "gemini-3.6-flash", input: .32, output: 1.6 },
  deepseek: { label: "DeepSeek V4-Pro", vendor: "DeepSeek", id: "deepseek-v4-pro", input: .882, output: 1.76 },
  glm: { label: "GLM-5.2", vendor: "智譜 AI", id: "glm-5.2", input: 1.37, output: 4.31 },
  kimi: { label: "Kimi K3", vendor: "Moonshot AI／月之暗面", id: "kimi-k3", input: 1.5, output: 7.5 },
};
function validModel(value: unknown): value is ModelKey { return typeof value === "string" && value in models; }
function meta(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }

async function runModel(key: ModelKey, prompt: string, subject: string) {
  const apiKey = await getTeamoRouterKey();
  if (!apiKey) throw new Error("TeamoRouter API Key 尚未設定或未啟用");
  const config = models[key];
  const system = `你是臺灣司法官、律師考試的爭點辨識專家。科目是${subject}。任務只有精準抓出題目中必須處理的法律爭點，不要寫完整擬答，不要自行補事實，不要虛構法條、判決或教材。請固定用以下格式：\n一、核心爭點（依得分重要性排序）\n二、每一爭點的觸發事實\n三、容易漏掉的隱藏爭點\n四、不是本題爭點／應排除的干擾\n五、需要題目補充的關鍵事實。\n每個爭點須具體命名並說明為何被題示事實觸發，控制在 900 字內。`;
  const started = Date.now();
  const response = await fetch(`${await getTeamoRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.id, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: .1, max_tokens: 2200, ...(key === "gemini" ? { reasoning_effort: "medium" } : {}) }),
  });
  const payload = await response.json().catch(() => ({})) as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
  const input = Number(payload.usage?.prompt_tokens || 0); const output = Number(payload.usage?.completion_tokens || 0);
  const estimated = Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage?.cost) : input / 1e6 * config.input + output / 1e6 * config.output;
  return { key, config, model: payload.model || config.id, text: payload.choices?.[0]?.message?.content?.trim() || "", input, output, duration: Date.now() - started, cost: estimated };
}

export async function GET() {
  try {
    const db = await getDb();
    const comparisons = await db.select().from(chatComparisons).where(eq(chatComparisons.contextType, contextType)).orderBy(desc(chatComparisons.id)).limit(20);
    const ids = comparisons.map((row) => row.id);
    const responses = ids.length ? await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, ids)) : [];
    const ratings = ids.length ? await db.select().from(chatComparisonRatings).where(inArray(chatComparisonRatings.comparisonId, ids)) : [];
    return Response.json({ runs: comparisons.map((row) => ({ ...row, meta: meta(row.sourceJson), responses: responses.filter((item) => item.comparisonId === row.id), ratings: ratings.filter((item) => item.comparisonId === row.id) })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; prompt?: string; subject?: string; models?: unknown[]; comparisonId?: number; responseId?: number; scores?: Record<string, number>; note?: string };
    const db = await getDb();
    if (body.action === "rate") {
      const scores = body.scores || {}; const values = ["coverage", "accuracy", "facts", "priority"].map((key) => Number(scores[key]));
      if (!body.comparisonId || !body.responseId || values.some((value) => !Number.isFinite(value) || value < 1 || value > 5)) return Response.json({ error: "請完成四項 1～5 分評分" }, { status: 400 });
      const score = Math.round(values.reduce((sum, value) => sum + value, 0) / 20 * 100);
      await db.insert(chatComparisonRatings).values({ comparisonId: body.comparisonId, responseId: body.responseId, userKey: "issue-lab", score, feedbackType: "issue-rubric", note: JSON.stringify({ scores, note: String(body.note || "").slice(0, 1000) }) });
      return Response.json({ ok: true, score });
    }
    const prompt = String(body.prompt || "").trim(); const subject = String(body.subject || "綜合").slice(0, 30);
    const selected = [...new Set((body.models || []).filter(validModel))];
    if (prompt.length < 30) return Response.json({ error: "請貼上完整題目事實（至少 30 字）" }, { status: 400 });
    if (selected.length < 2) return Response.json({ error: "請至少選擇 2 個模型比較" }, { status: 400 });
    const [comparison] = await db.insert(chatComparisons).values({ userKey: "issue-lab", contextType, promptText: prompt, sourceStatus: "issue_arena", sourceJson: JSON.stringify({ subject, selected, gateway: "teamorouter" }) }).returning();
    const settled = await Promise.allSettled(selected.map((key) => runModel(key, prompt, subject)));
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]; const key = selected[index]; const config = models[key];
      if (result.status === "fulfilled") {
        const run = result.value;
        await db.insert(chatComparisonResponses).values({ comparisonId: comparison.id, provider: "teamorouter", model: run.model, label: `${config.vendor}｜${config.label}`, text: run.text, inputTokens: run.input, outputTokens: run.output, durationMs: run.duration, estimatedCostUsdMicros: Math.round(run.cost * 1e6) });
        await db.insert(usageLogs).values({ model: run.model, source: `TeamoRouter 爭點辨識擂台 #${comparison.id}`, inputTokens: run.input, outputTokens: run.output, estimatedCostUsdMicros: Math.round(run.cost * 1e6) });
      } else {
        await db.insert(chatComparisonResponses).values({ comparisonId: comparison.id, provider: "teamorouter", model: config.id, label: `${config.vendor}｜${config.label}`, text: "", error: result.reason instanceof Error ? result.reason.message : "模型呼叫失敗" });
      }
    }
    return Response.json({ ok: true, comparisonId: comparison.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "測試失敗" }, { status: 500 }); }
}
