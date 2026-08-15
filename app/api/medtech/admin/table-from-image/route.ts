import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text.trim();
  }
  return "";
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定。" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "請提供表格圖片。" }, { status: 400 });
  if (file.size > 6_000_000) return Response.json({ error: "圖片太大，請先縮小後再轉換。" }, { status: 413 });
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
    model: "gpt-5.6-luna",
    instructions: "你是醫學教材版面轉換助手。只處理圖片中的表格，不解題、不改寫文字。請辨識表格邊界、合併欄標題、列欄順序與儲存格文字，輸出可直接插入 contentEditable 的安全 HTML table。若圖片不是表格或無法可靠辨識，html 回傳空字串。禁止 Markdown、script、style、事件屬性與外部連結。保留原文繁體中文、英文、括號與換行。",
    input: [{ role: "user", content: [{ type: "input_text", text: "請把這張圖片中的表格轉成真正可編輯、可複製到 Word 的 HTML 表格。" }, { type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" }] }],
    text: { format: { type: "json_schema", name: "table_from_image", strict: true, schema: { type: "object", additionalProperties: false, properties: { html: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" } }, required: ["html", "confidence", "note"] } } },
    max_output_tokens: 2200,
  }) });
  let parsed: { html?: string; confidence?: string; note?: string } = {};
  try { parsed = JSON.parse(outputText(payload)) as typeof parsed; } catch { return Response.json({ error: "AI 表格辨識結果格式錯誤。" }, { status: 502 }); }
  const html = sanitizeRichHtml(String(parsed.html ?? "").trim());
  if (!html || !/<table[\s>]/i.test(html)) return Response.json({ error: String(parsed.note || "這張圖片無法可靠辨識為表格，請保留原圖或手動插入表格。"), confidence: parsed.confidence || "low" }, { status: 422 });
  return Response.json({ html, confidence: parsed.confidence || "medium", note: parsed.note || "已轉換為 HTML 表格。" });
}
