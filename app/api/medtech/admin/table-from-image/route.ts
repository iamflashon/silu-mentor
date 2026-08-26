import { requireMedtechQuestionEditor } from "../../../../../lib/member-auth";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";
import { usageLogs } from "../../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../../lib/usage";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text.trim();
  }
  return "";
}

export async function POST(request: Request) {
  const auth = await requireMedtechQuestionEditor(request);
  if ("error" in auth) return auth.error;
  if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定。" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "請提供表格圖片。" }, { status: 400 });
  if (file.size > 6_000_000) return Response.json({ error: "圖片太大，請先縮小後再轉換。" }, { status: 413 });
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
    model: "gpt-5.6-luna",
    instructions: "你是醫學教材版面轉換助手。不解題、不改寫文字。完整辨識圖片內容：有表格時保留表格邊界、合併欄標題、列欄順序並輸出安全 HTML table；沒有表格時，依原圖段落與換行輸出 p、ol、ul 等可編輯 HTML。禁止 Markdown、script、style、事件屬性與外部連結。保留原文繁體中文、英文、括號、符號與換行。",
    input: [{ role: "user", content: [{ type: "input_text", text: "請把整張圖片轉成可編輯、可複製到 Word 的 HTML；有表格就保留表格，沒有表格就忠實轉成文字。" }, { type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" }] }],
    text: { format: { type: "json_schema", name: "table_from_image", strict: true, schema: { type: "object", additionalProperties: false, properties: { html: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" } }, required: ["html", "confidence", "note"] } } },
    max_output_tokens: 2200,
  }) });
  const usage=payload.usage&&typeof payload.usage==="object"?payload.usage as {input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number}}:{};
  const inputTokens=Number(usage.input_tokens??0),outputTokens=Number(usage.output_tokens??0),cachedTokens=Number(usage.input_tokens_details?.cached_tokens??0),model="gpt-5.6-luna",estimatedCostUsdMicros=estimateCostUsdMicros(model,{inputTokens,outputTokens,cachedTokens});
  await auth.db.insert(usageLogs).values({model,source:"教材編輯｜醫檢｜圖片轉文字／表格",inputTokens,outputTokens,cachedTokens,fileSearchCalls:0,estimatedCostUsdMicros}).catch(()=>undefined);
  let parsed: { html?: string; confidence?: string; note?: string } = {};
  try { parsed = JSON.parse(outputText(payload)) as typeof parsed; } catch { return Response.json({ error: "AI 表格辨識結果格式錯誤。" }, { status: 502 }); }
  const html = sanitizeRichHtml(String(parsed.html ?? "").trim());
  if (!html) return Response.json({ error: String(parsed.note || "這張圖片無法可靠辨識，請保留原圖或手動輸入。"), confidence: parsed.confidence || "low" }, { status: 422 });
  return Response.json({ html, confidence: parsed.confidence || "medium", note: parsed.note || (/<table[\s>]/i.test(html)?"已轉換為 HTML 表格。":"已轉換為可編輯文字。"),usage:{model,inputTokens,outputTokens,cachedTokens,estimatedCostUsd:estimatedCostUsdMicros/1_000_000} });
}
