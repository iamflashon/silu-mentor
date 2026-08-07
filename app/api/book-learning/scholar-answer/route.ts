import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions, usageLogs } from "../../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIKey, getOpenAIModel } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";

type Provider = "luna" | "sonnet" | "deepseek";
type TeachingLevel = "beginner" | "intermediate" | "advanced" | "super";

function readOpenAiText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "");
  }).join("").trim();
}

function readAnthropicText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join("").trim();
}

function readDeepSeekText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  return (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content?.trim() ?? "";
}

function usageFrom(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : undefined;
  return {
    inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0),
    cachedTokens: Number(details?.cached_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0),
  };
}

function providerFrom(value: unknown): Provider | null {
  if (value === "luna" || value === "sonnet" || value === "deepseek") return value;
  return null;
}

function levelRule(level?: TeachingLevel) {
  if (level === "beginner") return "用白話但保持法律精確，直接回答老師問的第一個核心點。";
  if (level === "intermediate") return "回答時把老師問的規範帶回章節內容與題目事實，不只背公式。";
  if (level === "advanced" || level === "super") return "可以處理老師問題中的隱藏前提與學說邊界，但不得自行開新爭點或把回答改成另一個問題。";
  return "依問題本身自然回答，不另開新的主題。";
}

async function runScholar(provider: Provider, instructions: string, input: string) {
  const startedAt = Date.now();
  if (provider === "luna") {
    const key = await getOpenAIKey();
    if (!key) throw new Error("Luna API 尚未設定");
    const model = await getOpenAIModel("gpt-5.6-luna");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, instructions, input, max_output_tokens: 2200 }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error("Luna 暫時無法回答老師的問題");
    const text = readOpenAiText(payload);
    if (!text) throw new Error("Luna 沒有產生可顯示的學霸回答");
    return { model, text, durationMs: Date.now() - startedAt, ...usageFrom(payload) };
  }
  if (provider === "sonnet") {
    const key = await getAnthropicKey();
    if (!key) throw new Error("Claude Sonnet API 尚未設定");
    const model = await getAnthropicChatModel("claude-sonnet-5");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, system: instructions, messages: [{ role: "user", content: input }], max_tokens: 2200 }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error("Claude Sonnet 暫時無法回答老師的問題");
    const text = readAnthropicText(payload);
    if (!text) throw new Error("Claude Sonnet 沒有產生可顯示的學霸回答");
    return { model, text, durationMs: Date.now() - startedAt, ...usageFrom(payload) };
  }
  const key = await getDeepSeekKey();
  if (!key) throw new Error("DeepSeek API 尚未設定");
  const model = await getDeepSeekModel("deepseek-v4-pro");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: input }], max_tokens: 2200 }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("DeepSeek 暫時無法回答老師的問題");
  const text = readDeepSeekText(payload);
  if (!text) throw new Error("DeepSeek 沒有產生可顯示的學霸回答");
  return { model, text, durationMs: Date.now() - startedAt, ...usageFrom(payload) };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      sessionId?: number | null;
      teacherText?: string;
      subject?: string;
      resourceTitle?: string;
      segmentTitle?: string;
      chapterText?: string;
      level?: TeachingLevel;
      modelMode?: string;
    };
    const teacherText = String(body.teacherText ?? "").trim();
    const provider = providerFrom(body.modelMode);
    if (!teacherText) return Response.json({ error: "目前沒有可回答的 AI 導師問題" }, { status: 400 });
    if (!provider) return Response.json({ error: "請先選擇單一回答模型；學霸回答不使用模型比較" }, { status: 400 });

    const subject = String(body.subject ?? "綜合").trim() || "綜合";
    const resourceTitle = String(body.resourceTitle ?? "教材").trim() || "教材";
    const segmentTitle = String(body.segmentTitle ?? "目前章節").trim() || "目前章節";
    const chapterText = String(body.chapterText ?? "").trim().slice(0, 12000);
    const instructions = `你是台灣司律考試的 AI 法律學霸，使用繁體中文與中華民國法律語境。你現在不是老師，也不是出題者。請直接回答 AI 導師剛才提出的問題；老師問什麼，就回答什麼。

要求：
1. 先直接回答老師的問題，再補充必要的規範、要件與題目涵攝；如果問題要求判斷，必須明確說出結論。
2. ${levelRule(body.level)}
3. 不要重新出題、不要把回答改寫成追問、不要只說「這是好問題」，也不要自行增加老師沒有問的新爭點。
4. 不要重述整段老師問題，不要輸出「選取內容」「處理要求」或任何內部提示文字。
5. 保持自然對話，控制在 170 至 330 字；不要使用 Markdown 標題、星號、反引號或長篇條列。

目前教材：${resourceTitle}
目前章節：${segmentTitle}
科目：${subject}
${chapterText ? `章節核對內容：\n${chapterText}` : "章節原文尚未完整核對；不得虛構教材內容。"}`;
    const input = `【老師的問題】\n${teacherText.slice(0, 8000)}`;
    const result = await runScholar(provider, instructions, input);
    const estimatedCostUsdMicros = estimateCostUsdMicros(result.model, result);
    const userKey = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
    const db = await getDb();
    if (body.sessionId) {
      const [session] = await db.select().from(chatSessions).where(and(eq(chatSessions.id, Number(body.sessionId)), eq(chatSessions.userKey, userKey))).limit(1);
      if (session) {
        await db.insert(chatMessages).values({ sessionId: session.id, role: "scholar", text: result.text, model: result.model, estimatedCostUsdMicros });
        await db.update(chatSessions).set({ updatedAt: new Date(), summary: result.text.replace(/\s+/g, " ").slice(0, 500), progressStatus: "active" }).where(eq(chatSessions.id, session.id));
      }
    }
    await db.insert(usageLogs).values({ model: result.model, source: `智能書｜AI 學霸回答老師問題｜${resourceTitle}`, inputTokens: result.inputTokens, cachedTokens: result.cachedTokens, outputTokens: result.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    return Response.json({ reply: result.text, role: "scholar", sessionId: body.sessionId ?? null, model: result.model, usage: { ...result, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI 學霸暫時無法回答老師的問題" }, { status: 500 });
  }
}
