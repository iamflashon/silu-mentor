import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";

type Turn = { role: "student" | "mentor"; text: string };
function outputText(payload: Record<string, unknown>) { if (typeof payload.output_text === "string") return payload.output_text.trim(); const output = Array.isArray(payload.output) ? payload.output : []; return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim(); }
function usedFileSearch(payload: Record<string, unknown>) { return Array.isArray(payload.output) && payload.output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "file_search_call"); }

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: Turn[] };
    const messages = (body.messages ?? []).filter((item) => item && ["student", "mentor"].includes(item.role) && typeof item.text === "string").slice(-10);
    const latest = [...messages].reverse().find((item) => item.role === "student")?.text.trim();
    if (!latest) return Response.json({ error: "請先輸入中級會計問題。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "中會 AI 模型尚未設定。" }, { status: 503 });
    const db = await getDb();
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    const [enabled] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.examCategory, "accounting"), eq(documents.homepageSearchEnabled, true), eq(documents.vectorIndexed, true))).limit(1);
    const allowSearch = Boolean(setting?.value && enabled);
    const model = "gpt-5.6-luna", startedAt = Date.now();
    const conversation = messages.map((item) => `${item.role === "student" ? "學生" : "中會 AI 教練"}：${item.text.slice(0, 2500)}`).join("\n\n");
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: "你是臺灣國考與校內考試的中級會計學 AI 教練。只能以中級會計學、IFRS 與所附會計教材範圍回答，絕不可混入司律或醫檢師內容。以繁體中文教學。先確認題目要求與已知條件，再依序說明適用準則、計算或分錄、最後核對。數字題必須逐步列式並檢查單位；分錄題要明列借方、貸方與金額；觀念題要區分原則、適用條件與常見陷阱。若資料不足，直接指出還缺哪些條件，不可自行補造數字。若 file_search 沒有命中教材，必須明示「本次未找到已開放的中會教材，以下為 AI 一般知識說明」，不可假稱教材支持。只輸出純文字，避免 Markdown 表格與標題符號。",
      input: conversation,
      ...(allowSearch ? { tools: [{ type: "file_search", vector_store_ids: [setting!.value], max_num_results: 8, filters: { type: "and", filters: [{ key: "exam_category", type: "eq", value: "accounting" }, { key: "homepage_enabled", type: "eq", value: true }] } }], include: ["file_search_call.results"] } : {}),
      max_output_tokens: 1200,
    }) }) as Record<string, unknown>;
    const reply = outputText(payload); if (!reply) return Response.json({ error: "中會 AI 暫時沒有完成回答，請再試一次。" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens || 0), outputTokens = Number(usage.output_tokens || 0), cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens });
    await db.insert(usageLogs).values({ model, source: "中會首頁 AI", inputTokens, outputTokens, cachedTokens, fileSearchCalls: usedFileSearch(payload) ? 1 : 0, estimatedCostUsdMicros });
    const searched = usedFileSearch(payload);
    return Response.json({ reply, source: searched ? "中會教材檢索＋AI 說明" : allowSearch ? "本次未命中中會教材" : "AI 一般知識說明（尚無已開放中會教材）", usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "中會 AI 回答失敗" }, { status: 500 }); }
}
