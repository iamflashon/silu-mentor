import { getDb } from "../../../../db";
import { chatMessages, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function usageOf(payload: Record<string, unknown>, model: string, durationMs: number) {
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
  return { model, inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, durationMs, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000, estimatedCostUsdMicros };
}

async function run(model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions, input, max_output_tokens: 1800 }) }) as Record<string, unknown>;
  const text = outputText(payload);
  if (!text) throw new Error("模型沒有產生可顯示的內容。");
  return { text, usage: usageOf(payload, model, Date.now() - startedAt) };
}

export async function POST(request: Request) {
  try {
    if (!await getOpenAIKey()) return Response.json({ error: "OpenAI API 尚未設定。" }, { status: 503 });
    const body = await request.json() as { sessionId?: number; prompt?: string; targetText?: string; targetModel?: string };
    const targetText = String(body.targetText ?? "").trim().slice(0, 16000);
    const prompt = String(body.prompt ?? "").trim().slice(0, 8000);
    const targetIsSol = /(?:^|[-_])sol(?:$|[-_])/i.test(String(body.targetModel ?? ""));
    const targetLabel = targetIsSol ? "Sol" : "Luna";
    const targetModel = targetIsSol ? "gpt-5.6-sol" : "gpt-5.6-luna";
    if (!targetText) return Response.json({ error: "請先勾選一則 Luna 或 Sol 訊息。" }, { status: 400 });

    const terra = await run("gpt-5.6-terra", "你是 Terra 法律質疑者。針對被選取的單一 AI 回答做有依據、可回應的檢核。先指出值得保留處，再提出至多三項真正影響正確性、完整性或可理解性的質疑；每項都要引述被質疑位置、說明問題與具體追問。若沒有實質問題，明說沒有成立的質疑，不得為吐槽而挑毛病，不得補造法條、裁判、教材或題目事實。", `【學生原問題】\n${prompt || "未取得原問題，僅檢核所選訊息"}\n\n【被質疑者】${targetLabel}\n【被選取的回答】\n${targetText}`);
    const reply = await run(targetModel, `你是${targetLabel}，正在回應 Terra 對你上一則回答的質疑。回答必須依序使用三個明確標題：「是否採納」「回應理由」「修正版段落」。是否採納只能寫採納、部分採納或不採納；修正版段落要能直接取代原回答，並只做質疑所必要的修改。不得為維護原答而強辯，也不得補造題目事實、法條或來源。`, `【學生原問題】\n${prompt || "未取得原問題"}\n\n【你的原回答】\n${targetText}\n\n【Terra 的質疑】\n${terra.text}`);

    try {
      const db = getDb();
      await db.insert(usageLogs).values([
        { model: terra.usage.model, source: `首頁對話／Terra質疑${targetLabel}`, inputTokens: terra.usage.inputTokens, cachedTokens: terra.usage.cachedTokens, outputTokens: terra.usage.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: terra.usage.estimatedCostUsdMicros },
        { model: reply.usage.model, source: `首頁對話／${targetLabel}回應Terra`, inputTokens: reply.usage.inputTokens, cachedTokens: reply.usage.cachedTokens, outputTokens: reply.usage.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: reply.usage.estimatedCostUsdMicros },
      ]);
      if (Number.isInteger(body.sessionId) && Number(body.sessionId) > 0) await db.insert(chatMessages).values([
        { sessionId: Number(body.sessionId), role: "mentor", text: terra.text, source: "AI 補充", model: terra.usage.model, estimatedCostUsdMicros: terra.usage.estimatedCostUsdMicros },
        { sessionId: Number(body.sessionId), role: "mentor", text: reply.text, source: "AI 補充", model: reply.usage.model, estimatedCostUsdMicros: reply.usage.estimatedCostUsdMicros },
      ]);
    } catch { /* 保存失敗不阻斷學生取得本輪結果 */ }
    const cleanUsage = ({ estimatedCostUsdMicros: _hidden, ...usage }: typeof terra.usage) => usage;
    const targetExcerpt = targetText.split(/\n+/).find((part) => part.trim().length >= 24)?.trim().slice(0, 360) ?? targetText.slice(0, 360);
    return Response.json({ targetLabel, targetExcerpt, challenge: { text: terra.text, usage: cleanUsage(terra.usage) }, reply: { text: reply.text, usage: cleanUsage(reply.usage) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Terra 暫時無法完成質疑。" }, { status: 500 });
  }
}
