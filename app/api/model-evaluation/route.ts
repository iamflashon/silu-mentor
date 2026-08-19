import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatComparisonResponses, chatComparisons, usageLogs } from "../../../db/schema";
import { benchmarkCases } from "../../../lib/model-benchmark";
import { comprehensiveBenchmarkCases } from "../../../lib/comprehensive-benchmark";
import { estimateCostUsd } from "../../../lib/usage";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getKimiBaseUrl, getKimiKey, getKimiModel, getOpenAIKey, getOpenRouterKey, getTeamoRouterBaseUrl, getTeamoRouterKey, getZaiKey, openAIJson } from "../../../lib/openai";

type Provider = "luna" | "qwen" | "terra" | "glm" | "sonnet" | "sol" | "opus" | "deepseek" | "deepseekfree" | "gemini" | "kimi";
type Gateway = "direct" | "openrouter" | "teamorouter" | "kimi";
type Bank = "criminal" | "comprehensive";
const contextType = "model-benchmark-v4";
const labels: Record<Provider, string> = {
  luna: "Luna", qwen: "千問", terra: "Terra", glm: "GLM", sonnet: "Claude Sonnet 5",
  sol: "Sol", opus: "Claude Opus 5", deepseek: "DeepSeek V4-Pro", deepseekfree: "DeepSeek V4 Flash 免費版", gemini: "Gemini 3.6 Flash", kimi: "Kimi K3",
};
const openRouterModels: Partial<Record<Provider, string>> = {
  qwen: "qwen/qwen3-max", glm: "z-ai/glm-5.2", sonnet: "anthropic/claude-sonnet-5",
  opus: "anthropic/claude-opus-5", deepseek: "deepseek/deepseek-v4-pro",
};
const teamoRouterModels: Partial<Record<Provider, string>> = {
  luna: "gpt-5.6-luna", terra: "gpt-5.6-terra", sol: "gpt-5.6-sol",
  sonnet: "claude-sonnet-5", opus: "claude-opus-5", deepseek: "deepseek-v4-pro",
  deepseekfree: "deepseek-v4-flash-free", glm: "glm-5.2", gemini: "gemini-3.6-flash", kimi: "kimi-k3",
};
const gatewayLabels: Record<Gateway, string> = { direct: "原廠 API", openrouter: "OpenRouter", teamorouter: "TeamoRouter", kimi: "Kimi 官方 API" };
const teamoPrices: Partial<Record<Provider, { input: number; output: number }>> = {
  luna: { input: .022, output: .132 }, terra: { input: .206, output: 1.24 }, sol: { input: .525, output: 3.15 },
  sonnet: { input: .356, output: 1.78 }, opus: { input: .815, output: 4.08 }, deepseek: { input: .882, output: 1.76 },
  deepseekfree: { input: 0, output: 0 }, glm: { input: 1.37, output: 4.31 }, gemini: { input: .32, output: 1.6 }, kimi: { input: 1.5, output: 7.5 },
};

type ExternalReview = { source: string; score: number; fatalCount: number; summary: string; rawText: string; reviewedAt: string };
type Source = { runId?: string; benchmarkId?: number; label?: string; provider?: Provider; gateway?: Gateway; bank?: Bank; status?: "active" | "ended"; thinkingLevel?: "medium"; externalReview?: ExternalReview };
function source(row: { sourceJson: string }): Source { try { return JSON.parse(row.sourceJson) as Source; } catch { return {}; } }
function questions(bank: Bank) { return bank === "comprehensive" ? comprehensiveBenchmarkCases : benchmarkCases; }
function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}
type CandidateRun = { model: string; text: string; input: number; output: number; duration: number; actualCostUsd?: number };
function validProvider(value: unknown): value is Provider { return typeof value === "string" && value in labels; }
function validBank(value: unknown): value is Bank { return value === "criminal" || value === "comprehensive"; }
function validGateway(value: unknown): value is Gateway { return value === "direct" || value === "openrouter" || value === "teamorouter" || value === "kimi"; }
async function selectInBatches<T>(values: number[], load: (batch: number[]) => Promise<T[]>) {
  const rows: T[] = [];
  for (let index = 0; index < values.length; index += 40) rows.push(...await load(values.slice(index, index + 40)));
  return rows;
}

async function runOpenAI(provider: "luna" | "terra" | "sol", prompt: string, system: string, started: number): Promise<CandidateRun> {
  if (!await getOpenAIKey()) throw new Error("OpenAI 金鑰尚未設定");
  const model = provider === "luna" ? "gpt-5.6-luna" : provider === "terra" ? "gpt-5.6-terra" : "gpt-5.6-sol";
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: 1800 }) });
  const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return { model, text: outputText(payload), input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0), duration: Date.now() - started };
}

async function runOpenRouter(provider: Provider, prompt: string, system: string, started: number): Promise<CandidateRun | null> {
  const key = await getOpenRouterKey(); const model = openRouterModels[provider];
  if (!key || !model) return null;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "HTTP-Referer": "https://silu-mentor.iamflashon.chatgpt.site", "X-Title": "司律備考單模型測試" }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: .2, max_tokens: 1800, reasoning: { effort: "low", exclude: true } }) });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!response.ok) throw new Error(`${labels[provider]} 呼叫失敗：${payload.error?.message || response.status}`);
  return { model, text: payload.choices?.[0]?.message?.content?.trim() || "", input: Number(payload.usage?.prompt_tokens ?? 0), output: Number(payload.usage?.completion_tokens ?? 0), duration: Date.now() - started, actualCostUsd: Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage?.cost) : undefined };
}

async function runTeamoRouter(provider: Provider, prompt: string, system: string, started: number): Promise<CandidateRun> {
  const key = await getTeamoRouterKey(); const model = teamoRouterModels[provider];
  if (!key) throw new Error("TeamoRouter API Key 尚未設定或未啟用");
  if (!model) throw new Error(`TeamoRouter 目前未設定 ${labels[provider]} 的模型 ID`);
  const response = await fetch(`${await getTeamoRouterBaseUrl()}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: .2, max_tokens: 1800, ...(provider === "gemini" ? { reasoning_effort: "medium" } : {}) }) });
  const payload = await response.json().catch(() => ({})) as { model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!response.ok) throw new Error(`TeamoRouter ${labels[provider]} 呼叫失敗：${payload.error?.message || `HTTP ${response.status}`}`);
  const text = payload.choices?.[0]?.message?.content?.trim() || ""; const input = Number(payload.usage?.prompt_tokens ?? 0); const output = Number(payload.usage?.completion_tokens ?? 0); const price = teamoPrices[provider];
  const listedCost = price ? input / 1_000_000 * price.input + output / 1_000_000 * price.output : undefined;
  return { model: payload.model || model, text, input, output, duration: Date.now() - started, actualCostUsd: Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage?.cost) : listedCost };
}

async function runKimiOfficial(prompt: string, system: string, started: number): Promise<CandidateRun> {
  const key = await getKimiKey();
  if (!key) throw new Error("Kimi 官方 API Key 尚未設定或未啟用");
  const model = await getKimiModel();
  const response = await fetch(`${await getKimiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: 1, max_tokens: 6000 }),
  });
  const payload = await response.json().catch(() => ({})) as { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string | Array<{ type?: string; text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!response.ok) throw new Error(`Kimi 官方 API 呼叫失敗：${payload.error?.message || `HTTP ${response.status}`}`);
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content) ? content.map((item) => item.text || "").join("\n").trim() : "";
  const input = Number(payload.usage?.prompt_tokens ?? 0);
  const output = Number(payload.usage?.completion_tokens ?? 0);
  if (text.length < 24) throw new Error(`Kimi K3 未產生完整答案（finish_reason：${choice?.finish_reason || "未提供"}；輸出 Token：${output}）。請直接重試本題，已完成紀錄不受影響`);
  return { model: payload.model || model, text, input, output, duration: Date.now() - started, actualCostUsd: Number.isFinite(Number(payload.usage?.cost)) ? Number(payload.usage?.cost) : undefined };
}

async function runCandidate(gateway: Gateway, provider: Provider, prompt: string): Promise<CandidateRun> {
  const system = "你是臺灣司律考試法律助教。只依題目與提供的同組對話紀錄分析，不得替換人物、案件或自行補充事實，不得虛構法條、裁判或教材。若資料不足，必須明示限制並作條件式分析。請辨識爭點、說明法律判準並具體涵攝，控制在700字內。";
  const started = Date.now();
  if (gateway === "kimi") {
    if (provider !== "kimi") throw new Error("Kimi 官方 API 目前僅提供 Kimi 官方模型測試");
    return runKimiOfficial(prompt, system, started);
  }
  if (gateway === "teamorouter") return runTeamoRouter(provider, prompt, system, started);
  if (gateway === "openrouter") { const routed = await runOpenRouter(provider, prompt, system, started); if (routed) return routed; throw new Error(`OpenRouter 尚未設定 ${labels[provider]} 或缺少 API Key`); }
  if (provider === "luna" || provider === "terra" || provider === "sol") return runOpenAI(provider, prompt, system, started);
  if (provider === "sonnet" || provider === "opus") {
    const key = await getAnthropicKey(); if (!key) throw new Error("OpenRouter 與 Anthropic 金鑰皆未設定");
    const model = provider === "opus" ? "claude-opus-5" : await getAnthropicChatModel("claude-sonnet-5");
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, system, messages: [{ role: "user", content: prompt }], max_tokens: 1800 }) });
    const payload = await response.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `${labels[provider]} 呼叫失敗`);
    return { model, text: payload.content?.map((x) => x.text || "").join("\n").trim() || "", input: Number(payload.usage?.input_tokens ?? 0), output: Number(payload.usage?.output_tokens ?? 0), duration: Date.now() - started };
  }
  if (provider === "deepseek") {
    const key = await getDeepSeekKey(); if (!key) throw new Error("OpenRouter 與 DeepSeek 金鑰皆未設定"); const model = await getDeepSeekModel("deepseek-v4-pro");
    const response = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: 1800 }) });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }; if (!response.ok) throw new Error(payload.error?.message || "DeepSeek 呼叫失敗");
    return { model, text: payload.choices?.[0]?.message?.content?.trim() || "", input: Number(payload.usage?.prompt_tokens ?? 0), output: Number(payload.usage?.completion_tokens ?? 0), duration: Date.now() - started };
  }
  if (provider === "glm") {
    const key = await getZaiKey(); if (!key) throw new Error("OpenRouter 與 Z.AI 金鑰皆未設定"); const model = "glm-5.2";
    const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], thinking: { type: "disabled" }, temperature: .2, max_tokens: 1800 }) });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }; if (!response.ok) throw new Error(payload.error?.message || "GLM 呼叫失敗");
    return { model, text: payload.choices?.[0]?.message?.content?.trim() || "", input: Number(payload.usage?.prompt_tokens ?? 0), output: Number(payload.usage?.completion_tokens ?? 0), duration: Date.now() - started };
  }
  throw new Error(`${gatewayLabels[gateway]}目前缺少 ${labels[provider]} 的模型連線設定`);
}

async function promptWithChainContext(
  db: Awaited<ReturnType<typeof getDb>>,
  runId: string,
  bank: Bank,
  question: ReturnType<typeof questions>[number],
  rows: Array<{ id: number; sourceJson: string }>,
) {
  if (question.group !== "連續追問" || question.round <= 1) return question.prompt;
  const earlier = questions(bank)
    .filter((item) => item.group === question.group && item.title === question.title && item.round < question.round)
    .sort((a, b) => a.round - b.round);
  const cards = earlier.map((item) => ({ item, card: rows.find((row) => source(row).runId === runId && source(row).benchmarkId === item.id) }));
  if (cards.some(({ card }) => !card)) throw new Error(`第 ${question.id} 題需要先完成同組前一輪，已停止以避免脈絡缺失`);
  const cardIds = cards.map(({ card }) => card!.id);
  const earlierResponses = await selectInBatches(cardIds, (batch) => db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, batch)));
  const history = cards.map(({ item, card }) => {
    const answer = earlierResponses.find((response) => response.comparisonId === card!.id)?.text?.trim();
    if (!answer) throw new Error(`第 ${question.id} 題缺少第 ${item.round} 輪回答，已停止以避免模型自行補故事`);
    return `【第 ${item.round} 輪】\n學生：${item.prompt}\n模型：${answer}`;
  }).join("\n\n");
  return `以下是同一案件、同一組連續追問的完整既有紀錄。人物與事實均須保持一致；若本輪沒有新增事實，不得自行添加。\n\n${history}\n\n【本輪第 ${question.round} 輪】\n學生：${question.prompt}\n\n請承接以上紀錄回答本輪問題，不要重新虛構另一個案件。`;
}

export async function GET(request: Request) {
  try {
    const db = await getDb(); const all = await db.select().from(chatComparisons).where(inArray(chatComparisons.contextType, [contextType, "model-benchmark-v3", "model-benchmark-v2"])).orderBy(asc(chatComparisons.id));
    const ids = all.map((x) => x.id);
    const responses = await selectInBatches(ids, (batch) => db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, batch)));
    const metas = all.filter((x) => source(x).benchmarkId === 0); const runIds = [...new Set(all.map((x) => source(x).runId).filter(Boolean) as string[])]; const activeRunIds = runIds.filter((id) => source(metas.find((x) => source(x).runId === id) ?? { sourceJson: "{}" }).status !== "ended");
    const requested = new URL(request.url).searchParams.get("runId"); const runId = requested && runIds.includes(requested) ? requested : activeRunIds.at(-1) || null;
    const meta = metas.find((x) => source(x).runId === runId); const settings = source(meta ?? { sourceJson: "{}" }); const bank: Bank = settings.bank ?? "criminal"; const provider: Provider = settings.provider ?? "deepseek"; const gateway: Gateway = settings.gateway ?? "direct";
    const runRows = runId ? all.filter((x) => source(x).runId === runId && source(x).benchmarkId !== 0) : [];
    const runs = runIds.map((id) => { const m = metas.find((x) => source(x).runId === id); const s = source(m ?? { sourceJson: "{}" }); const cards = all.filter((x) => source(x).runId === id && source(x).benchmarkId !== 0); const answerCount = responses.filter((r) => cards.some((c) => c.id === r.comparisonId)).length; return { id, label: s.label || "舊測試紀錄", startedAt: m?.createdAt, answered: answerCount, completed: answerCount, total: 50, provider: s.provider ?? "deepseek", gateway: s.gateway ?? "direct", bank: s.bank ?? "criminal", thinkingLevel: s.thinkingLevel, externalReview: s.externalReview }; });
    return Response.json({ target: 50, runId, provider, gateway, bank, thinkingLevel: settings.thinkingLevel, externalReview: settings.externalReview, runs, questions: questions(bank).map((q) => { const card = runRows.find((x) => source(x).benchmarkId === q.id); return { ...q, responses: card ? responses.filter((r) => r.comparisonId === card.id).map((r) => ({ ...r, verdict: null })) : [] }; }) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "測試資料讀取失敗" }, { status: 500 }); }
}

export async function POST(request: Request) {
  let stage = "準備測試";
  try {
    const body = await request.json() as { action?: string; runId?: string; questionId?: number; provider?: Provider; gateway?: Gateway; bank?: Bank; review?: Partial<ExternalReview> }; const db = await getDb();
    if (body.action === "create-run") {
      if (!validProvider(body.provider) || !validGateway(body.gateway) || !validBank(body.bank)) return Response.json({ error: "請先選擇供應商、模型與題庫" }, { status: 400 });
      const runId = `run-${Date.now()}`; const now = new Date(); const label = `${now.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })} ${now.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" })}`;
      await db.insert(chatComparisons).values({ userKey: "benchmark", contextType, promptText: `${gatewayLabels[body.gateway]}｜${labels[body.provider]}｜${body.bank === "comprehensive" ? "綜合法科" : "刑法"}50題`, sourceStatus: "run_meta", sourceJson: JSON.stringify({ runId, benchmarkId: 0, label, gateway: body.gateway, provider: body.provider, bank: body.bank, ...(body.provider === "gemini" ? { thinkingLevel: "medium" } : {}) }) });
      return Response.json({ ok: true, runId });
    }
    const runId = String(body.runId || ""); if (!runId) return Response.json({ error: "測試參數不完整" }, { status: 400 });
    const rows = await db.select().from(chatComparisons).where(eq(chatComparisons.contextType, contextType)); const meta = rows.find((x) => source(x).runId === runId && source(x).benchmarkId === 0); if (!meta) return Response.json({ error: "找不到這一輪測試紀錄" }, { status: 404 });
    if (body.action === "end-run") { await db.update(chatComparisons).set({ sourceStatus: "run_ended", sourceJson: JSON.stringify({ ...source(meta), status: "ended" }) }).where(eq(chatComparisons.id, meta.id)); return Response.json({ ok: true }); }
    if (body.action === "save-review") {
      const review = body.review; const score = Number(review?.score); const fatalCount = Number(review?.fatalCount);
      if (!review || !Number.isFinite(score) || score < 0 || score > 100 || !Number.isInteger(fatalCount) || fatalCount < 0 || fatalCount > 50) return Response.json({ error: "請確認總分為 0～100、致命錯誤為 0～50" }, { status: 400 });
      const externalReview: ExternalReview = { source: String(review.source || "ChatGPT 外部評測").slice(0, 80), score, fatalCount, summary: String(review.summary || "").slice(0, 2000), rawText: String(review.rawText || "").slice(0, 30000), reviewedAt: new Date().toISOString() };
      await db.update(chatComparisons).set({ sourceJson: JSON.stringify({ ...source(meta), externalReview }) }).where(eq(chatComparisons.id, meta.id));
      return Response.json({ ok: true, externalReview });
    }
    const settings = source(meta); const provider = settings.provider; const gateway = settings.gateway ?? "direct"; const bank = settings.bank ?? "criminal"; if (!provider) return Response.json({ error: "舊批次沒有指定單模型，請建立新一輪" }, { status: 400 });
    const q = questions(bank).find((x) => x.id === Number(body.questionId)); if (!q) return Response.json({ error: "找不到題目" }, { status: 404 });
    let card = rows.find((x) => source(x).runId === runId && source(x).benchmarkId === q.id); if (!card) [card] = await db.insert(chatComparisons).values({ userKey: "benchmark", contextType, promptText: q.prompt, sourceStatus: "benchmark_card", sourceJson: JSON.stringify({ runId, benchmarkId: q.id, gateway, provider, bank, rule: q.rule, expected: q.expected }) }).returning();
    const prior = await db.select().from(chatComparisonResponses).where(and(eq(chatComparisonResponses.comparisonId, card.id), eq(chatComparisonResponses.provider, gateway))).limit(1); if (prior.length) return Response.json({ ok: true, skipped: true });
    stage = `${gatewayLabels[gateway]} ${labels[provider]} 整理連續脈絡`; const candidatePrompt = await promptWithChainContext(db, runId, bank, q, rows);
    stage = `${gatewayLabels[gateway]} ${labels[provider]} 作答`; const run = await runCandidate(gateway, provider, candidatePrompt); if (run.text.trim().length < 24) throw new Error(`${labels[provider]} 回答過短或空白`);
    const cost = run.actualCostUsd ?? estimateCostUsd(run.model, { inputTokens: run.input, cachedTokens: 0, outputTokens: run.output });
    await db.insert(chatComparisonResponses).values({ comparisonId: card.id, provider: gateway, model: run.model, label: `${labels[provider]}｜${gatewayLabels[gateway]}`, text: run.text, inputTokens: run.input, outputTokens: run.output, durationMs: run.duration, estimatedCostUsdMicros: Math.round(cost * 1e6) });
    await db.insert(usageLogs).values({ model: run.model, source: `${gatewayLabels[gateway]} 50題法律模型測試 ${runId}`, inputTokens: run.input, outputTokens: run.output, estimatedCostUsdMicros: Math.round(cost * 1e6) });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "測試失敗", stage }, { status: 500 }); }
}
