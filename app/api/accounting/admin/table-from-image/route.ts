import { requireAccountingAdmin } from "../../../../../lib/member-auth";
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
  const auth = await requireAccountingAdmin(request);
  if ("error" in auth) return auth.error;
  if (!await getOpenAIKey()) return Response.json({ error: "會計 AI 模型尚未設定。" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "請提供分錄或表格圖片。" }, { status: 400 });
  if (file.size > 6_000_000) return Response.json({ error: "圖片太大，請先縮小後再轉換。" }, { status: 413 });
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
    model: "gpt-5.6-luna",
    instructions: "你是會計教材版面轉換助手。完整保留圖片中的所有文字與表格，不解題、不改寫、不刪除表格外文字。依圖片由上到下順序輸出安全 HTML：分錄或欄列資料用 table；表格上方或下方的計算式、期初餘額、期末餘額、括號說明等用 p。忠實保留借貸排列、合併欄、空白儲存格與框線位置。原圖中有單底線的金額，在對應 span 設定 text-decoration:underline；雙底線則設定 border-bottom:3px double currentColor、padding-bottom:1px，不得用虛線或點線代替。表格只在原圖確實有線的位置設定 border；沒有線的邊不得補線。所有元素背景必須透明，不得設定 background、background-color 或 bgcolor。禁止 Markdown、script、style 標籤、事件屬性與外部連結。",
    input: [{ role: "user", content: [{ type: "input_text", text: "請將整張圖片完整轉成可編輯 HTML。表格與表格外文字都必須保留，並保留金額雙底線及實際框線。" }, { type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" }] }],
    text: { format: { type: "json_schema", name: "accounting_layout_from_image", strict: true, schema: { type: "object", additionalProperties: false, properties: { html: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" } }, required: ["html", "confidence", "note"] } } },
    max_output_tokens: 3200,
  }) });
  const usage=payload.usage&&typeof payload.usage==="object"?payload.usage as {input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number}}:{};
  const inputTokens=Number(usage.input_tokens??0),outputTokens=Number(usage.output_tokens??0),cachedTokens=Number(usage.input_tokens_details?.cached_tokens??0),model="gpt-5.6-luna",estimatedCostUsdMicros=estimateCostUsdMicros(model,{inputTokens,outputTokens,cachedTokens});
  await auth.db.insert(usageLogs).values({model,source:"教材編輯｜中會｜圖片轉文字／表格",inputTokens,outputTokens,cachedTokens,fileSearchCalls:0,estimatedCostUsdMicros}).catch(()=>undefined);
  let parsed: { html?: string; confidence?: string; note?: string } = {};
  try { parsed = JSON.parse(outputText(payload)) as typeof parsed; } catch { return Response.json({ error: "AI 版面辨識結果格式錯誤。" }, { status: 502 }); }
  const html = sanitizeRichHtml(String(parsed.html ?? "").trim());
  if (!html) return Response.json({ error: String(parsed.note || "無法可靠辨識圖片內容。"), confidence: parsed.confidence || "low" }, { status: 422 });
  return Response.json({ html, confidence: parsed.confidence || "medium", note: parsed.note || "已保留表格與周邊文字。",usage:{model,inputTokens,outputTokens,cachedTokens,estimatedCostUsd:estimatedCostUsdMicros/1_000_000} });
}
