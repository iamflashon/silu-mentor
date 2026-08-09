import { getOpenAIKey, openAIJson } from "../../../lib/openai";
import { getDb } from "../../../db";
import { usageLogs } from "../../../db/schema";
import { estimateCostUsdMicros } from "../../../lib/usage";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function parseStructured(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as { explanation?: unknown; analysis?: unknown };
    return { explanation: String(value.explanation ?? "").trim(), analysis: value.analysis && typeof value.analysis === "object" ? value.analysis : null };
  } catch {
    return { explanation: text, analysis: null };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { selectedText?: string; article?: { title?: string; articleNo?: string; content?: string } };
    const title = String(body.article?.title ?? "").slice(0, 120);
    const articleNo = String(body.article?.articleNo ?? "").slice(0, 80);
    const content = String(body.article?.content ?? "").slice(0, 6000);
    const selectedText = String(body.selectedText ?? "").slice(0, 120);
    if (!content && selectedText.length < 2) return Response.json({ error: "請先框選要解釋的文字。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "白話解釋模型尚未設定。" }, { status: 503 });
    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是臺灣法律學習助教。辨識框選內容屬於法條、裁判字號、法律概念、學說或一般法律文字，並做考試導向的白話拆解。法規簡稱必須正規化，例如「憲訴法」是「憲法訴訟法」、「民訴法」是「民事訴訟法」、「刑訴法」是「刑事訴訟法」。若能辨識條、項、款，逐層拆開。只有提供資料庫原文時，才可說已核對原文；否則應註明仍須查證，不得補造條文、裁判或題目事實。輸出必須是單一 JSON 物件，不要 markdown：{"analysis":{"kind":"類型","officialName":"正式名稱或空字串","legalField":"法領域","nature":"法律性質","reference":"法規／條／項／款的完整拆解或空字串","points":["重點1","重點2"],"verification":"建議查證來源","caveat":"必要提醒"},"explanation":"150至300字白話解釋"}`,
      input: content ? `【框選文字】\n${selectedText}\n\n【已下載法規資料庫原文】\n${title} ${articleNo}\n${content}` : `【框選文字】\n${selectedText}`,
      max_output_tokens: 700,
    }) }) as Record<string, unknown>;
    const parsed = parseStructured(outputText(payload));
    const explanation = parsed.explanation;
    if (!explanation) return Response.json({ error: "未產生可顯示的白話解釋。" }, { status: 502 });
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(usage.input_tokens ?? 0);
    const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    const durationMs = Date.now() - startedAt;
    try {
      const db = getDb();
      await db.insert(usageLogs).values({ model, source: "全站智能框選｜白話解釋", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    } catch { /* 成本紀錄失敗不應中斷學生取得解釋 */ }
    return Response.json({ explanation, analysis: parsed.analysis, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "白話解釋暫時無法完成。" }, { status: 500 });
  }
}
