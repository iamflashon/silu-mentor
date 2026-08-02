type ClientMessage = { role: "mentor" | "student"; text: string };
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, usageLogs } from "../../../db/schema";

const instructions = `你是「司律導師」，專門協助台灣律師與司法官考試的主動式 AI 學習教練。
你的任務是教會學生思考，不是立刻交付完整答案。

對話規則：
1. 使用繁體中文與中華民國法律語境。
2. 像真人老師自然對話，每次聚焦一個清楚、學生可以直接回答的問題。
3. 主動判斷學生的程度與下一個學習步驟，不等待學生設計課程。
4. 優先引導學生辨認題目事實、爭點與法律關係；除非學生明確要求，不要第一輪就公布完整解答。
5. 學生答錯時，先指出已經抓對的部分，再給一層提示或更小的問題。
6. 不要使用僵硬的「教學卡、步驟一、步驟二」口吻，不要一次問很多問題。
7. 若資訊不足或法律內容不確定，要直接說明，不得捏造法條、判決或教材來源。
8. 回覆通常控制在 80 至 220 個中文字；必要時可稍長。
9. 若檔案搜尋工具找到教材內容，必須以教材為優先依據；找不到時才使用一般模型知識，且不得捏造教材來源。`;

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

function usedFileSearch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const output = (payload as { output?: unknown[] }).output;
  return Array.isArray(output) && output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "file_search_call");
}

function chooseModel(messages: ClientMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "student")?.text ?? "";
  if (/完整批改|申論批改|評分|逐段改寫|模擬閱卷/.test(latest)) return "gpt-5.6-sol";
  if (latest.length > 500 || /深入分析|學說比較|實務見解|判決分析|完整涵攝|爭點整理/.test(latest)) return "gpt-5.6-terra";
  return "gpt-5.6-luna";
}

const modelRates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.10, cached: 0.01, output: 0.60 },
  "gpt-5.6-terra": { input: 1.00, cached: 0.10, output: 6.00 },
  "gpt-5.6-sol": { input: 2.50, cached: 0.25, output: 15.00 },
};

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const inputTokens = Number(usage?.input_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? 0);
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : null;
  const cachedTokens = Number(details?.cached_tokens ?? 0);
  return { inputTokens, outputTokens, cachedTokens };
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "OPENAI_API_KEY 尚未設定於司律導師的伺服器環境" }, { status: 503 });
    }

    const body = await request.json() as { messages?: ClientMessage[] };
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    if (!messages.length) return Response.json({ error: "缺少對話內容" }, { status: 400 });

    let vectorStoreId = "";
    try {
      const db = await getDb();
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
      vectorStoreId = setting?.value ?? "";
    } catch { /* answer from model knowledge until the index is ready */ }

    const selectedModel = process.env.OPENAI_MODEL || chooseModel(messages);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        instructions,
        input: messages.map((message) => ({
          role: message.role === "mentor" ? "assistant" : "user",
          content: message.text,
        })),
        ...(vectorStoreId ? { tools: [{ type: "file_search", vector_store_ids: [vectorStoreId], max_num_results: 8 }] } : {}),
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ error: "AI 服務暫時無法回應" }, { status: 502 });
    }
    const reply = extractText(payload);
    if (!reply) return Response.json({ error: "AI 未產生可顯示內容" }, { status: 502 });

    const fromFiles = usedFileSearch(payload);
    const usage = readUsage(payload);
    const rates = modelRates[selectedModel] ?? modelRates["gpt-5.6-luna"];
    const nonCachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
    const tokenCost = (nonCachedInput * rates.input + usage.cachedTokens * rates.cached + usage.outputTokens * rates.output) / 1_000_000;
    const fileSearchCost = fromFiles ? 0.0025 : 0;
    const estimatedCostUsd = tokenCost + fileSearchCost;
    try {
      const db = await getDb();
      await db.insert(usageLogs).values({
        model: selectedModel,
        source: fromFiles ? "教材" : "AI 補充",
        inputTokens: usage.inputTokens,
        cachedTokens: usage.cachedTokens,
        outputTokens: usage.outputTokens,
        fileSearchCalls: fromFiles ? 1 : 0,
        estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1_000_000),
      });
    } catch { /* usage logging must not block the learner */ }

    return Response.json({
      reply,
      source: fromFiles ? "教材" : "AI 補充",
      usage: { model: selectedModel, ...usage, fileSearchCalls: fromFiles ? 1 : 0, estimatedCostUsd },
    });
  } catch {
    return Response.json({ error: "對話處理失敗" }, { status: 500 });
  }
}
