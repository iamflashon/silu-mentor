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
  let body: { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel; subject?: string; question?: string };
  try {
    body = await request.json() as { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel; subject?: string; question?: string };
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
  const subject = String(body.subject ?? "綜合").trim() || "綜合";
  const question = String(body.question ?? "").trim();
  const subjectRule = subject.includes("公司") || subject.includes("商事")
    ? "這是公司法／商事法題目。只能使用公司機關、股東／董事身分、法律關係、權利義務、決議效力、規範與涵攝等語彙；不得把它寫成刑法案例，不得自行加入犯罪、故意、未遂或因果關係。"
    : subject.includes("刑法") && !subject.includes("刑事訴訟")
      ? "這是刑法題目，可以依題目內容討論行為、犯罪構成、故意、未遂、共犯與因果關係，但不得捏造題目沒有的事實。"
      : `這是${subject}題目，請依該科目的法律關係與規範回答，不要套用其他法科的固定模板。`;
  const teacherText = responses.map((response) => `${response.label || "老師"}（${response.model || ""}）：\n${String(response.text).slice(0, 6000)}`).join("\n\n");
  const levelLabel = body.level === "beginner" ? "法律小白" : body.level === "intermediate" ? "基礎考生" : body.level === "advanced" ? "進階考生" : body.level === "super" ? "頂尖學霸" : "目前程度的學生";
  const levelRule = body.level === "beginner"
    ? "用白話指出一個還不懂的地方，讓導師可以直接解釋。"
    : body.level === "intermediate"
      ? "鎖定一個尚未套入本題事實的要件，問它在本題中如何判斷。"
      : body.level === "advanced" || body.level === "super"
        ? "鎖定原回答中的一個前提、要件或涵攝缺口，提出精準但仍可直接回答的問題，不開新爭點。"
        : "自然指出一個尚未釐清的具體疑問，讓導師接著教。";
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: `你是正在測試司律 AI 導師的${levelLabel}學生，不是老師，也不是評審。這題的科目是${subject}。${subjectRule}請針對學生指定的那一則訊息，寫出一則自然、短小、可以直接放進對話框的「AI 學霸回覆」。

要求：
1. 先用一至兩句話自然回應你對指定訊息的理解，再提出一個問題；這兩部分都必須像學生在和導師聊天，不是系統說明。
2. ${levelRule}
3. 只問一個問題。不要要求同時比較兩說、選邊站、說明整套理論或回答多個子問題。
4. 不得加入指定訊息沒有出現的事實、法條、判決或新爭點，也不要重述整段訊息。
5. 絕對不要輸出「【選取內容】」「追問給你」「處理要求」「請選邊站」或其他內部提示文字。
6. 不要使用標題、條列、Markdown 或引號包住全文；使用繁體中文，約 60 至 150 字，直接輸出學霸要說的內容。`,
      input: `題目科目：${subject}\n題目內容：${question.slice(0, 5000)}\n\n學生指定的訊息：\n${teacherText}`,
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
