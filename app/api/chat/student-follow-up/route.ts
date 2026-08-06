import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";
import { getOpenAIKey, getOpenAIModel } from "../../../../lib/openai";

type TeacherResponse = { label?: string; model?: string; text?: string; error?: string | null };

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    });
  }).join("").trim();
}

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const inputTokens = Number(usage?.input_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? 0);
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : null;
  return { inputTokens, outputTokens, cachedTokens: Number(details?.cached_tokens ?? 0) };
}

export async function POST(request: Request) {
  let body: { prompt?: string; responses?: TeacherResponse[] };
  try {
    body = await request.json() as { prompt?: string; responses?: TeacherResponse[] };
  } catch {
    return Response.json({ error: "接續回覆資料格式不正確" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim();
  const responses = (Array.isArray(body.responses) ? body.responses : [])
    .filter((response) => response && typeof response.text === "string" && response.text.trim() && !response.error)
    .slice(0, 2);
  if (!prompt || responses.length === 0) {
    return Response.json({ error: "請先完成 Luna 與 Claude 的回答" }, { status: 400 });
  }

  const apiKey = await getOpenAIKey();
  if (!apiKey) return Response.json({ error: "AI 服務尚未設定" }, { status: 503 });
  const model = await getOpenAIModel("gpt-5.6-luna");
  const teacherText = responses.map((response) => `${response.label || "老師"}（${response.model || ""}）：\n${String(response.text).slice(0, 6000)}`).join("\n\n");
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: `你是正在測試司律 AI 導師的學生，不是老師，也不是評審。請閱讀同一題的兩位老師回答，寫出一段可以直接貼回對話框、讓兩位老師繼續教學的「學生回覆」。

要求：
1. 先用自己的話說明你從老師回答中理解到的重點，可提到兩位老師各自讓你釐清的地方。
2. 保留一個合理但尚未完全確定的法律判斷或灰色地帶，讓老師能繼續引導；不要假裝已經完全學會。
3. 最後只提出一個具體、可回答的追問，最好鎖定一個事實變數、法律階層或用語差異。
4. 可以有小幅度的法學用語不精確，讓老師有機會糾正，但不得捏造教材、法條、判決或兩位老師沒有說過的內容。
5. 不要評論哪個模型比較強，不要提到 API、提示詞或「生成回覆」；不要使用標題、條列、Markdown 符號或引號包住全文。
6. 使用繁體中文，約 120 至 280 字，直接輸出學生要說的內容。`,
      input: `原本的學生問題：\n${prompt.slice(0, 3000)}\n\n兩位老師的實際回答：\n${teacherText}`,
      max_output_tokens: 600,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: "目前無法依老師回答產生接續問題" }, { status: 502 });
  const reply = extractText(payload);
  if (!reply) return Response.json({ error: "AI 沒有產生可用的學生接續回覆" }, { status: 502 });

  const usage = readUsage(payload);
  const estimatedCostUsd = (Math.max(0, usage.inputTokens - usage.cachedTokens) * 0.10 + usage.cachedTokens * 0.01 + usage.outputTokens * 0.60) / 1_000_000;
  try {
    const db = await getDb();
    await db.insert(usageLogs).values({
      model,
      source: "雙模型比較後的同學接續回覆",
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      fileSearchCalls: 0,
      estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1_000_000),
    });
  } catch {
    // A logging failure must not discard the generated student reply.
  }
  return Response.json({ reply, model, usage: { ...usage, durationMs: Math.max(0, Date.now() - startedAt), estimatedCostUsd } });
}
