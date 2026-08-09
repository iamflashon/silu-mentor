import { getOpenAIKey, openAIJson } from "../../../lib/openai";
import { getDb } from "../../../db";
import { usageLogs } from "../../../db/schema";
import { estimateCostUsdMicros } from "../../../lib/usage";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
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
      instructions: content ? "你是臺灣法律學習助教。只能依使用者提供的現行法條原文，以繁體中文做白話解釋。先用一句話說規範什麼，再逐項說明構成要素；若使用者框選到特定項，優先解釋該項。不得補造條文、判決或題目事實，不得把白話解釋說成老師擬答。控制在350字內，純文字輸出。" : "你是臺灣法律學習助教。只針對使用者框選的文字做繁體中文白話解釋，說清楚這段話在法律學習上的意思；資訊不足時要明說，不得自行補造法條、判決或題目事實。控制在300字內，純文字輸出。",
      input: content ? `【框選文字】\n${selectedText}\n\n【已下載法規資料庫原文】\n${title} ${articleNo}\n${content}` : `【框選文字】\n${selectedText}`,
      max_output_tokens: 700,
    }) }) as Record<string, unknown>;
    const explanation = outputText(payload);
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
    return Response.json({ explanation, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "白話解釋暫時無法完成。" }, { status: 500 });
  }
}
