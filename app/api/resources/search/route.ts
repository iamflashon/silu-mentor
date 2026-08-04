import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, learningResources, usageLogs } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

type SearchPayload = {
  hits?: Array<{
    section?: string;
    excerpt?: string;
    page_start?: number | null;
    page_end?: number | null;
    relevance?: string;
  }>;
};

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []);
  }).join("").trim();
}

function searchedSelectedFile(payload: Record<string, unknown>, fileId: string, fileName: string) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.some((item) => {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "file_search_call") return false;
    const results = Array.isArray((item as { results?: unknown[] }).results) ? (item as { results: unknown[] }).results : [];
    return results.some((result) => result && typeof result === "object" && ((result as { file_id?: string }).file_id === fileId || (result as { filename?: string }).filename === fileName));
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { resourceId?: number; query?: string };
    const resourceId = Number(body.resourceId);
    const query = String(body.query ?? "").trim().slice(0, 120);
    if (!Number.isInteger(resourceId) || resourceId < 1 || query.length < 2)
      return Response.json({ error: "請輸入至少兩個字的書中主題" }, { status: 400 });

    const db = await getDb();
    const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
    if (!resource || resource.resourceType !== "book") return Response.json({ error: "找不到這本智能書" }, { status: 404 });
    if (!resource.documentId) return Response.json({ error: "這本書尚未綁定教材全文" }, { status: 409 });
    const [document] = await db.select().from(documents).where(eq(documents.id, resource.documentId)).limit(1);
    if (!document?.openaiFileId || document.status !== "completed") return Response.json({ error: "這本書的教材全文索引尚未完成" }, { status: 409 });
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    if (!setting?.value) return Response.json({ error: "教材全文索引尚未就緒" }, { status: 409 });

    const model = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        include: ["file_search_call.results"],
        instructions: "你是台灣法律教材檢索員。必須使用 file_search 搜尋指定教材全文。只回傳確實由該教材片段支持的結果，不得依一般法律知識補造。section 填片段所屬篇、章、節或最接近的原書標題；excerpt 用自己的話忠實摘要命中內容，最多 90 字，不得長篇抄錄；頁碼無法確認填 null。若指定教材沒有命中，hits 回傳空陣列。",
        input: `只搜尋教材《${resource.title}》，原始檔名「${document.fileName}」，查找主題「${query}」。請同時考慮法律同義詞、上位與下位概念，例如未遂、障礙未遂、不能未遂、普通未遂等，但結果必須真的出現在這份教材的索引內容中。最多回傳 8 個最相關位置。`,
        tools: [{ type: "file_search", vector_store_ids: [setting.value], max_num_results: 20 }],
        text: { format: { type: "json_schema", name: "book_fulltext_search", strict: true, schema: {
          type: "object", additionalProperties: false, properties: { hits: { type: "array", maxItems: 8, items: {
            type: "object", additionalProperties: false,
            properties: { section: { type: "string" }, excerpt: { type: "string" }, page_start: { type: ["integer", "null"] }, page_end: { type: ["integer", "null"] }, relevance: { type: "string" } },
            required: ["section", "excerpt", "page_start", "page_end", "relevance"]
          } } }, required: ["hits"] } } },
      }),
    });
    let parsed: SearchPayload = { hits: [] };
    try { parsed = JSON.parse(outputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")) as SearchPayload; } catch { /* empty result */ }
    const selectedFileWasSearched = searchedSelectedFile(payload, document.openaiFileId, document.fileName);
    const hits = selectedFileWasSearched ? (parsed.hits ?? []).filter((hit) => hit.section?.trim() && hit.excerpt?.trim()).slice(0, 8) : [];
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    await db.insert(usageLogs).values({ model: String(payload.model ?? model), source: "智能書全文搜尋", inputTokens: usage.input_tokens ?? 0, cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, fileSearchCalls: 1, estimatedCostUsdMicros: 2500 }).catch(() => undefined);
    return Response.json({ hits, query, resourceId, searched: "full_text", selectedFileWasSearched });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "教材全文搜尋暫時無法使用" }, { status: 503 });
  }
}
