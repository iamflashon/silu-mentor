import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documentSearchUnits, documents, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";

function fileSearchResults(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "file_search_call") return [];
    const results = Array.isArray((item as { results?: unknown[] }).results) ? (item as { results: unknown[] }).results : [];
    return results.filter((result): result is Record<string, unknown> => Boolean(result && typeof result === "object"));
  });
}

function resultText(result: Record<string, unknown>) {
  if (typeof result.text === "string") return result.text.trim();
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => typeof item.text === "string" ? item.text : "")
    .join("\n")
    .trim();
}

function resultNumber(result: Record<string, unknown>, key: string) {
  const value = Number(result[key]);
  return Number.isFinite(value) ? value : null;
}

function resultPage(result: Record<string, unknown>, key: string) {
  const direct = resultNumber(result, key);
  if (direct) return direct;
  const attributes = result.attributes;
  if (!attributes || typeof attributes !== "object") return null;
  const value = Number((attributes as Record<string, unknown>)[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { documentId?: number; query?: string };
    const documentId = Number(body.documentId);
    const query = String(body.query ?? "").trim().slice(0, 120);
    if (!Number.isInteger(documentId) || documentId < 1 || query.length < 2) {
      return Response.json({ error: "請輸入至少兩個字的測試關鍵字" }, { status: 400 });
    }

    const db = await getDb();
    const terms = [...new Set(query.normalize("NFKC").toLocaleLowerCase("zh-Hant").split(/[\s、，。；：,.;:()（）]+/u).filter((item) => item.length >= 2))].slice(0, 6);
    const lexicalRows = terms.length ? await db.select({
      title: documentSearchUnits.title,
      text: documentSearchUnits.text,
      pageStart: documentSearchUnits.pageStart,
      pageEnd: documentSearchUnits.pageEnd,
      hierarchyPath: documentSearchUnits.hierarchyPath,
      sequence: documentSearchUnits.sequence,
    }).from(documentSearchUnits).where(and(
      eq(documentSearchUnits.documentId, documentId),
      or(...terms.map((term) => like(documentSearchUnits.normalizedText, `%${term}%`))),
    )).orderBy(desc(sql<number>`case when ${documentSearchUnits.normalizedText} like ${`%${query.normalize("NFKC").toLocaleLowerCase("zh-Hant")}%`} then 2 else 1 end`), documentSearchUnits.sequence).limit(8) : [];
    const lexicalHits = lexicalRows.map((row) => ({
      fileName: "精準頁面索引",
      score: null,
      text: row.text.slice(0, 900),
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      title: row.title,
      hierarchyPath: row.hierarchyPath,
      retrievalMode: "fine_lexical",
    }));
    const [document] = await db.select({
      id: documents.id,
      fileName: documents.fileName,
      bookTitle: documents.bookTitle,
      status: documents.status,
      fullTextIndexed: documents.fullTextIndexed,
      vectorIndexed: documents.vectorIndexed,
      openaiFileId: documents.openaiFileId,
    }).from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    if (document.status !== "completed" || !document.openaiFileId || !document.vectorIndexed) {
      if (lexicalHits.length) return Response.json({ documentId, query, selectedFileWasSearched: true, hits: lexicalHits, retrievalModes: ["fine_lexical"], index: { fullTextIndexed: Boolean(document.fullTextIndexed), vectorIndexed: Boolean(document.vectorIndexed) } });
      return Response.json({
        error: "這份教材尚未完成向量索引，請先重新處理教材。",
        code: "INDEX_NOT_READY",
        index: { fullTextIndexed: Boolean(document.fullTextIndexed), vectorIndexed: Boolean(document.vectorIndexed) },
      }, { status: 409 });
    }
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    if (!setting?.value) return Response.json({ error: "向量資料庫尚未設定" }, { status: 409 });
    if (!await getOpenAIKey()) return Response.json({ error: "OPENAI_API_KEY 尚未設定" }, { status: 503 });

    const model = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "這是後台教材索引測試。必須使用 file_search；只檢查指定教材是否有實際命中，不要依一般知識補造內容。",
        input: `只搜尋檔案「${document.fileName}」，測試關鍵字：「${query}」。請找出最相關的原文片段。`,
        tools: [{ type: "file_search", vector_store_ids: [setting.value], max_num_results: 8 }],
        tool_choice: "required",
        include: ["file_search_call.results"],
        max_output_tokens: 300,
      }),
    }) as Record<string, unknown>;
    const allResults = fileSearchResults(payload);
    const vectorHits = allResults
      .filter((result) => result.file_id === document.openaiFileId || result.filename === document.fileName)
      .map((result) => ({
        fileName: String(result.filename || document.fileName),
        score: resultNumber(result, "score"),
        text: resultText(result).slice(0, 900),
        pageStart: resultPage(result, "page_start"),
        pageEnd: resultPage(result, "page_end"),
      }))
      .filter((result) => result.text)
      .slice(0, 8);
    const hits = [...lexicalHits, ...vectorHits.map((hit) => ({ ...hit, retrievalMode: "vector" }))]
      .filter((hit, index, rows) => rows.findIndex((candidate) => candidate.pageStart === hit.pageStart && candidate.text.slice(0, 100) === hit.text.slice(0, 100)) === index)
      .slice(0, 8);
    const usage = payload.usage && typeof payload.usage === "object"
      ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
      : {};
    const inputTokens = Number(usage.input_tokens || 0);
    const outputTokens = Number(usage.output_tokens || 0);
    const cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
    await db.insert(usageLogs).values({
      model: String(payload.model || model),
      source: "後台教材向量索引測試",
      inputTokens,
      outputTokens,
      cachedTokens,
      fileSearchCalls: 1,
      estimatedCostUsdMicros: estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens }),
    }).catch(() => undefined);
    return Response.json({
      documentId,
      query,
      selectedFileWasSearched: hits.length > 0,
      hits,
      retrievalModes: [...new Set(hits.map((hit) => hit.retrievalMode))],
      index: { fullTextIndexed: Boolean(document.fullTextIndexed), vectorIndexed: Boolean(document.vectorIndexed) },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "教材向量索引測試失敗" }, { status: 503 });
  }
}
