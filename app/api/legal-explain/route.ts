import { getOpenAIKey, openAIJson } from "../../../lib/openai";

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
    if (!title || !articleNo || !content) return Response.json({ error: "缺少可供解釋的完整法條。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "白話解釋模型尚未設定。" }, { status: 503 });
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: "你是臺灣法律學習助教。只能依使用者提供的現行法條原文，以繁體中文做白話解釋。先用一句話說規範什麼，再逐項說明構成要素；若使用者框選到特定項，優先解釋該項。不得補造條文、判決或題目事實，不得把白話解釋說成老師擬答。控制在350字內，純文字輸出。",
      input: `【框選文字】\n${selectedText}\n\n【已下載法規資料庫原文】\n${title} ${articleNo}\n${content}`,
      max_output_tokens: 700,
    }) }) as Record<string, unknown>;
    const explanation = outputText(payload);
    if (!explanation) return Response.json({ error: "未產生可顯示的白話解釋。" }, { status: 502 });
    return Response.json({ explanation });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "白話解釋暫時無法完成。" }, { status: 500 });
  }
}
