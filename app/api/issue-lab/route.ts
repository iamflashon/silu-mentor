import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatComparisonRatings, chatComparisonResponses, chatComparisons, examQuestions, usageLogs } from "../../../db/schema";
import { getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIKey, getTeamoRouterBaseUrl, getTeamoRouterKey, openAIJson } from "../../../lib/openai";

type ModelKey = "luna" | "sol" | "terra" | "sonnet" | "opus" | "gemini" | "deepseek" | "glm" | "kimi";
type Gateway = "direct" | "teamorouter";
type EvidenceMode = "without" | "with";
const contextType = "issue-spotting-arena-v1";
const models: Record<ModelKey, { label: string; vendor: string; id: string; input: number; output: number }> = {
  luna: { label: "Luna", vendor: "OpenAI", id: "gpt-5.6-luna", input: .105, output: .63 },
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
function validGateway(value: unknown): value is Gateway { return value === "direct" || value === "teamorouter"; }
function meta(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }

type CompatibleContentPart = { type?: string; text?: string; content?: string };
type CompatibleMessage = {
  content?: string | CompatibleContentPart[] | null;
  reasoning_content?: string | null;
};

function extractDisplayText(message?: CompatibleMessage) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "")
      .join("\n")
      .trim();
  }
  return "";
}

function providerOptions(key: ModelKey) {
  if (key === "deepseek") return { temperature: 0.6 };
  if (key === "glm" || key === "kimi") return { thinking: { type: "disabled" } };
  if (key === "gemini") return { temperature: 0.1, reasoning_effort: "medium" };
  return { temperature: 0.1 };
}

class ModelCallError extends Error {
  constructor(message: string, public duration: number, public status?: number) {
    super(message);
    this.name = "ModelCallError";
  }
}

function providerErrorMessage(status: number, detail?: string) {
  if (status === 524) return "TeamoRouter 上游模型等待逾時（HTTP 524）。本次未收到 token 用量，平台未記錄費用；是否產生供應商端費用仍以 TeamoRouter 帳單為準。請稍後手動重試。";
  if (status === 429) return "TeamoRouter 目前請求過多（HTTP 429），請稍後手動重試。";
  if (status >= 500) return `TeamoRouter 上游服務暫時異常（HTTP ${status}），請稍後手動重試。`;
  return detail || `TeamoRouter 呼叫失敗（HTTP ${status}）`;
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

async function runModel(key: ModelKey, prompt: string, subject: string, gateway: Gateway, teacherAnswer = "") {
  const config = models[key];
  const evidenceInstruction = teacherAnswer
    ? `\n\n【同一題老師擬答／爭點解析（檢索所得，只作為核對依據）】\n${teacherAnswer.slice(0, 14000)}\n\n必須以這份同題資料校準爭點完整度、法律定位與結論；不得冒充官方唯一答案。`
    : "\n\n本組未提供任何老師擬答或解析，只能依題目本身辨識，不得假稱已檢索資料。";
  const system = `你是臺灣司法官、律師考試的爭點辨識專家。科目是${subject}。任務只有精準抓出題目中必須處理的法律爭點，不要寫完整擬答，不要自行補事實，不要虛構法條、判決或教材。先依題目中的每一位行為人逐人完成罪名與總則爭點掃描，不得因爭點次要、結論不成立或需要簡短排除而省略；掃描完成後再依重要性整理。請固定用以下格式：\n一、核心配分爭點（依得分重要性排序）\n二、次要但應檢討的爭點\n三、應簡短排除的不成立罪名與理由\n四、每一爭點的觸發事實\n五、真正需要題目補充的關鍵事實（如無，明確寫無）。\n每個爭點須具體命名、盡可能標示法條並說明被哪項題示事實觸發；不得把題目已明示的事實列為待補。控制在 1200 字內。${evidenceInstruction}`;
  const started = Date.now();
  if (gateway === "direct") {
    if (key === "luna" || key === "sol" || key === "terra") {
      if (!await getOpenAIKey()) throw new ModelCallError("OpenAI 官方 API Key 尚未設定。", Date.now() - started);
      const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model: config.id, instructions: system, input: prompt, max_output_tokens: key === "sol" ? 2200 : 2600 }) }) as Record<string, unknown>;
      const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
      const input = Number(usage.input_tokens ?? 0); const output = Number(usage.output_tokens ?? 0); const text = outputText(payload);
      return { key, config, model: String(payload.model || config.id), text, error: text ? "" : "空白回覆：官方 API 未回傳可顯示內容", input, output, duration: Date.now() - started, cost: input / 1e6 * config.input + output / 1e6 * config.output };
    }
    if (key === "sonnet" || key === "opus") {
      const apiKey = await getAnthropicKey();
      if (!apiKey) throw new ModelCallError("Anthropic 官方 API Key 尚未設定。", Date.now() - started);
      const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: config.id, system, messages: [{ role: "user", content: prompt }], max_tokens: 2600 }) });
      const payload = await response.json().catch(() => ({})) as { model?: string; content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
      if (!response.ok) throw new ModelCallError(payload.error?.message || `Anthropic 官方 API 呼叫失敗（HTTP ${response.status}）`, Date.now() - started, response.status);
      const input = Number(payload.usage?.input_tokens ?? 0); const output = Number(payload.usage?.output_tokens ?? 0); const text = payload.content?.map((item) => item.text || "").join("\n").trim() || "";
      return { key, config, model: payload.model || config.id, text, error: text ? "" : "空白回覆：官方 API 未回傳可顯示內容", input, output, duration: Date.now() - started, cost: input / 1e6 * config.input + output / 1e6 * config.output };
    }
    if (key === "deepseek") {
      const apiKey = await getDeepSeekKey();
      if (!apiKey) throw new ModelCallError("DeepSeek 官方 API Key 尚未設定或未啟用。", Date.now() - started);
      const model = await getDeepSeekModel(config.id);
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          max_tokens: 2600,
          ...providerOptions(key),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { model?: string; choices?: Array<{ message?: CompatibleMessage; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      if (!response.ok) {
        const detail = payload.error?.message?.trim();
        const message = response.status === 401 || response.status === 403
          ? "DeepSeek 官方 API Key 無效、未啟用或沒有此模型權限。"
          : response.status === 402
            ? "DeepSeek 官方帳戶餘額不足。"
            : response.status === 429
              ? "DeepSeek 官方 API 請求過多或額度已達上限，請稍後重試。"
              : detail || `DeepSeek 官方 API 呼叫失敗（HTTP ${response.status}）`;
        throw new ModelCallError(message, Date.now() - started, response.status);
      }
      const input = Number(payload.usage?.prompt_tokens || 0); const output = Number(payload.usage?.completion_tokens || 0);
      const choice = payload.choices?.[0]; const text = extractDisplayText(choice?.message); const finishReason = String(choice?.finish_reason || "unknown");
      const sections = ["一、", "二、", "三、", "四、", "五、"];
      const contentError = !text
        ? output > 0
          ? `無正文：DeepSeek 已產生 ${output.toLocaleString()} 個輸出 tokens，但未形成可顯示的最終回答（停止原因：${finishReason}）`
          : "空白回覆：DeepSeek 官方 API 未回傳可顯示內容"
        : (["length", "max_tokens"].includes(finishReason) || sections.some((heading) => !text.includes(heading)))
          ? `內容截斷：回覆未完成五個指定段落（停止原因：${finishReason}）`
          : "";
      return { key, config, model: payload.model || model, text, error: contentError, input, output, duration: Date.now() - started, cost: input / 1e6 * config.input + output / 1e6 * config.output };
    }
    throw new ModelCallError(`${config.label} 尚未建立原廠直連；請改用 TeamoRouter，或先在模型設定補上官方 API。`, Date.now() - started);
  }
  const apiKey = await getTeamoRouterKey();
  if (!apiKey) throw new Error("TeamoRouter API Key 尚未設定或未啟用");
  const response = await fetch(`${await getTeamoRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.id,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      // The requested answer is capped at 1,200 Chinese characters. Keeping the
      // completion budget bounded reduces long-running gateway requests while
      // still leaving room for all five required sections.
      max_tokens: key === "sol" ? 2200 : 2600,
      ...providerOptions(key),
    }),
  });
  const payload = await response.json().catch(() => ({})) as { model?: string; choices?: Array<{ message?: CompatibleMessage; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!response.ok) throw new ModelCallError(providerErrorMessage(response.status, payload.error?.message), Date.now() - started, response.status);
  const input = Number(payload.usage?.prompt_tokens || 0); const output = Number(payload.usage?.completion_tokens || 0);
  const estimated = Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage?.cost) : input / 1e6 * config.input + output / 1e6 * config.output;
  const choice = payload.choices?.[0]; const text = extractDisplayText(choice?.message); const finishReason = String(choice?.finish_reason || "unknown");
  const reasoningTokensWithoutAnswer = !text && output > 0 && Boolean(choice?.message?.reasoning_content?.trim());
  const sections = ["一、", "二、", "三、", "四、", "五、"];
  const contentError = !text
    ? reasoningTokensWithoutAnswer || output > 0
      ? `無正文：已產生 ${output.toLocaleString()} 個計費輸出 tokens，但輸出額度用於內部推理，未形成可顯示的最終回答（停止原因：${finishReason}）`
      : "空白回覆：供應商未回傳可顯示內容，也未記錄輸出 tokens"
    : (["length", "max_tokens"].includes(finishReason) || sections.some((heading) => !text.includes(heading)))
      ? `內容截斷：回覆未完成五個指定段落（停止原因：${finishReason}）`
      : "";
  return { key, config, model: payload.model || config.id, text, error: contentError, input, output, duration: Date.now() - started, cost: estimated };
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
    const body = await request.json() as { action?: string; prompt?: string; subject?: string; models?: unknown[]; gateways?: unknown[]; evidenceTest?: boolean; questionId?: number; repetitions?: number; comparisonId?: number; responseId?: number; review?: string };
    const db = await getDb();
    if (body.action === "save-review") {
      const review = String(body.review || "").trim();
      if (!body.comparisonId || !review) return Response.json({ error: "請貼上或輸入統一評測內容" }, { status: 400 });
      const [anchor] = await db.select().from(chatComparisonResponses).where(eq(chatComparisonResponses.comparisonId, body.comparisonId)).limit(1);
      if (!anchor) return Response.json({ error: "這輪測試沒有可連結的模型結果" }, { status: 404 });
      await db.insert(chatComparisonRatings).values({ comparisonId: body.comparisonId, responseId: anchor.id, userKey: "issue-lab", score: 0, feedbackType: "issue-unified-review", note: review.slice(0, 30000) });
      return Response.json({ ok: true });
    }
    if (body.action === "retry") {
      if (!body.comparisonId || !body.responseId) return Response.json({ error: "缺少重試資料" }, { status: 400 });
      const [comparison] = await db.select().from(chatComparisons).where(and(eq(chatComparisons.id, body.comparisonId), eq(chatComparisons.contextType, contextType))).limit(1);
      const [prior] = await db.select().from(chatComparisonResponses).where(and(eq(chatComparisonResponses.id, body.responseId), eq(chatComparisonResponses.comparisonId, body.comparisonId))).limit(1);
      const [sourceKey, sourceGateway = "teamorouter", sourceEvidence = "without"] = String(prior?.source || "").split("|") as [ModelKey, Gateway, EvidenceMode];
      const key = sourceKey;
      if (!comparison || !prior || !validModel(key)) return Response.json({ error: "找不到可重試的模型結果" }, { status: 404 });
      const savedMeta = meta(comparison.sourceJson); let teacherAnswer = "";
      if (sourceEvidence === "with" && Number(savedMeta.questionId)) { const [question] = await db.select({ teacherAnswer: examQuestions.teacherAnswer }).from(examQuestions).where(eq(examQuestions.id, Number(savedMeta.questionId))).limit(1); teacherAnswer = question?.teacherAnswer?.trim() || ""; }
      const run = await runModel(key, comparison.promptText, String(savedMeta.subject || "綜合"), validGateway(sourceGateway) ? sourceGateway : "teamorouter", teacherAnswer);
      await db.update(chatComparisonResponses).set({ model: run.model, text: run.text, error: run.error || null, inputTokens: run.input, outputTokens: run.output, durationMs: run.duration, estimatedCostUsdMicros: Math.round(run.cost * 1e6) }).where(eq(chatComparisonResponses.id, prior.id));
      await db.insert(usageLogs).values({ model: run.model, source: `${sourceGateway === "direct" ? "原廠 API" : "TeamoRouter"} 爭點辨識擂台重試 #${comparison.id}`, inputTokens: run.input, outputTokens: run.output, estimatedCostUsdMicros: Math.round(run.cost * 1e6) });
      return Response.json({ ok: true });
    }
    const prompt = String(body.prompt || "").trim(); const subject = String(body.subject || "綜合").slice(0, 30);
    const selected = [...new Set((body.models || []).filter(validModel))];
    const gateways = [...new Set((body.gateways || ["teamorouter"]).filter(validGateway))];
    if (prompt.length < 30) return Response.json({ error: "請貼上完整題目事實（至少 30 字）" }, { status: 400 });
    if (selected.length < 1) return Response.json({ error: "請至少選擇 1 個模型" }, { status: 400 });
    if (gateways.length < 1) return Response.json({ error: "請至少選擇 1 個 API 來源" }, { status: 400 });
    let teacherAnswer = "";
    if (body.evidenceTest) {
      const [question] = await db.select({ stem: examQuestions.stem, teacherAnswer: examQuestions.teacherAnswer }).from(examQuestions).where(and(eq(examQuestions.id, Number(body.questionId)), eq(examQuestions.status, "published"))).limit(1);
      teacherAnswer = question?.teacherAnswer?.trim() || "";
      if (!question || !teacherAnswer) return Response.json({ error: "擬答 A/B 測試只能使用已連結老師擬答的站內真題" }, { status: 400 });
      if (question.stem.trim() !== prompt) return Response.json({ error: "擬答 A/B 測試必須使用未改寫的完整站內真題，確保兩組輸入可公平比較" }, { status: 400 });
    }
    const repetitions = selected.length === 1 && [1, 3, 5].includes(Number(body.repetitions)) ? Number(body.repetitions) : 1;
    const baseKeys = selected.length === 1 && gateways.length === 1 && !body.evidenceTest ? Array.from({ length: repetitions }, () => selected[0]) : selected;
    const variants = baseKeys.flatMap((key) => gateways.flatMap((gateway) => (body.evidenceTest ? (["without", "with"] as EvidenceMode[]) : (["without"] as EvidenceMode[])).map((evidence) => ({ key, gateway, evidence }))));
    const [comparison] = await db.insert(chatComparisons).values({ userKey: "issue-lab", contextType, promptText: prompt, sourceStatus: "issue_arena", sourceJson: JSON.stringify({ subject, selected, repetitions, gateways, evidenceTest: Boolean(body.evidenceTest), questionId: body.questionId || null }) }).returning();
    const settled = await Promise.allSettled(variants.map((variant) => runModel(variant.key, prompt, subject, variant.gateway, variant.evidence === "with" ? teacherAnswer : "")));
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]; const variant = variants[index]; const { key, gateway, evidence } = variant; const config = models[key]; const attemptSuffix = repetitions > 1 && variants.length === repetitions ? `｜第 ${index + 1} 次` : ""; const evidenceLabel = evidence === "with" ? "｜已檢索同題擬答" : body.evidenceTest ? "｜未提供擬答" : ""; const gatewayLabel = gateway === "direct" ? "原廠 API" : "TeamoRouter";
      if (result.status === "fulfilled") {
        const run = result.value;
        await db.insert(chatComparisonResponses).values({ comparisonId: comparison.id, provider: gateway, model: run.model, label: `${config.vendor}｜${config.label}｜${gatewayLabel}${evidenceLabel}${attemptSuffix}`, source: `${key}|${gateway}|${evidence}`, text: run.text, error: run.error || null, inputTokens: run.input, outputTokens: run.output, durationMs: run.duration, estimatedCostUsdMicros: Math.round(run.cost * 1e6) });
        await db.insert(usageLogs).values({ model: run.model, source: `${gatewayLabel} 爭點辨識擂台 #${comparison.id}${evidenceLabel}`, inputTokens: run.input, outputTokens: run.output, estimatedCostUsdMicros: Math.round(run.cost * 1e6) });
      } else {
        const failure = result.reason;
        await db.insert(chatComparisonResponses).values({ comparisonId: comparison.id, provider: gateway, model: config.id, label: `${config.vendor}｜${config.label}｜${gatewayLabel}${evidenceLabel}${attemptSuffix}`, source: `${key}|${gateway}|${evidence}`, text: "", error: failure instanceof Error ? failure.message : "模型呼叫失敗", durationMs: failure instanceof ModelCallError ? failure.duration : 0 });
      }
    }
    return Response.json({ ok: true, comparisonId: comparison.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "測試失敗" }, { status: 500 }); }
}
