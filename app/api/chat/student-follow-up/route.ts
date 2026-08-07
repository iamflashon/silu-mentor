import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";
import { getOpenAIKey, getOpenAIModel } from "../../../../lib/openai";

type TeacherResponse = { label?: string; model?: string; text?: string; error?: string | null };
type TeachingLevel = "beginner" | "intermediate" | "advanced" | "super";

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
      if (text && typeof text === "object" && typeof (text as { value?: unknown }).value === "string") {
        return (text as { value: string }).value;
      }
      return "";
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
  let body: { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel };
  try {
    body = await request.json() as { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel };
  } catch {
    return Response.json({ error: "接續回覆資料格式不正確" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim();
  const responses = (Array.isArray(body.responses) ? body.responses : [])
    .filter((response) => response && typeof response.text === "string" && response.text.trim() && !response.error)
    .slice(0, 3);
  if (!prompt || responses.length === 0) {
    return Response.json({ error: "請先完成目前選定模型的回答" }, { status: 400 });
  }

  const apiKey = await getOpenAIKey();
  if (!apiKey) return Response.json({ error: "AI 服務尚未設定" }, { status: 503 });
  const model = await getOpenAIModel("gpt-5.6-luna");
  const teacherText = responses.map((response) => `${response.label || "老師"}（${response.model || ""}）：\n${String(response.text).slice(0, 6000)}`).join("\n\n");
  const levelLabel = body.level === "beginner" ? "法律小白" : body.level === "intermediate" ? "基礎考生" : body.level === "advanced" ? "進階考生" : body.level === "super" ? "頂尖學霸" : "目前程度的學生";
  const levelRule = body.level === "beginner"
    ? "呈現觀念混亂、把生活中的『有意做動作』與法律上的故意責任混在一起，也可以流露挫折或懷疑自己不適合法律；追問必須來自本題實際內容，不要固定套用某個例子。"
    : body.level === "intermediate"
      ? "先說出看似完整的理論公式並詢問是否足以拿高分，但刻意保留一至兩個尚未帶入的題目事實，讓老師必須指出『只背公式、沒有涵攝』；追問哪一個具體事實會改變結論。"
      : body.level === "advanced"
        ? "採取一個有根據的非通說或競爭學說立場，完整提出法律效果與可避免性等論證，再挑戰老師為何必須採通說；要求處理兩說的實質利益、責任標籤或價值差異，不接受只報學說名稱。"
        : body.level === "super"
          ? "展現已能統整體系、辨識隱藏爭點與反例的頂尖程度，針對老師回答的論證前提或可能漏洞，提出一個足以測出教學深度的高難度追問。"
          : "自然承接老師回答，提出一個尚未完全釐清的具體疑問。";
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: `你是正在測試司律 AI 導師的${levelLabel}學生，不是老師，也不是評審。請閱讀同一題中目前已選模型的實際回答，寫出一段可以直接貼回主對話框、讓老師繼續教學的學生回覆。

要求：
1. 先用自己的話說明你從老師回答中理解到的重點；若有兩位老師，可以自然整合兩者，不要比較誰比較好。
2. 保留一個合理但尚未完全確定的法律判斷或灰色地帶，讓老師能繼續引導；不要假裝已經完全學會。
3. ${levelRule}
4. 最後只提出一個具體、可回答的追問。
5. 不得捏造教材、法條、判決或老師沒有說過的內容。
6. 不要評論哪個模型比較強，不要提到 API、提示詞或「生成回覆」；不要使用標題、條列、Markdown 符號或引號包住全文。
7. 使用繁體中文，約 120 至 280 字，直接輸出學生要說的內容。`,
      input: `原本的學生問題：\n${prompt.slice(0, 3000)}\n\n目前已選模型的實際回答：\n${teacherText}`,
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
      source: body.level ? `程度學生接續回覆｜${levelLabel}` : "依老師回覆生成同學接續回覆",
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
