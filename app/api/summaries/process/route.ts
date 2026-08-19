import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, usageLogs } from "../../../../db/schema";
import { openAIHeaders } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { studentSummaryStoragePrefix } from "../../../../lib/student-summary";

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []);
  }).join("").trim();
}

function parseJson(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return null; }
}

function imageType(contentType: string) {
  return /^image\/(png|jpeg|webp)$/i.test(contentType);
}

function processingError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "AI 整理摘要失敗";
}

export async function POST(request: Request) {
  let documentId = 0;
  try {
    const body = await request.json() as { id?: number };
    documentId = Number(body.id);
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "摘要編號不正確" }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document || document.documentType !== "student-summary" || !document.storageKey.startsWith(studentSummaryStoragePrefix(request))) return Response.json({ error: "找不到這份上傳資料" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) throw new Error("找不到原始上傳檔案");
    const bytes = await object.arrayBuffer();
    const model = "gpt-5.6-luna";
    const storedResult = document.processingResultJson ? parseJson(document.processingResultJson) ?? {} : {};
    const topic = String(storedResult.topic ?? "").trim();
    await db.update(documents).set({ status: "analyzing", processingStage: "analyzing", processingMessage: "Luna 正在整理摘要", indexError: null }).where(eq(documents.id, documentId));

    const content = imageType(document.contentType)
      ? [{ type: "input_image", image_url: `data:${document.contentType};base64,${Buffer.from(bytes).toString("base64")}` }]
      : [{ type: "input_file", filename: document.fileName, file_data: `data:${document.contentType};base64,${Buffer.from(bytes).toString("base64")}` }];
    const prompt = `請整理檔案「${document.fileName}」，科目為「${document.subject}」${topic ? `，使用者自訂分類主題為「${topic}」` : ""}。核心任務是產出一份精簡摘要：刪除贅詞與重複內容，但保留理解全文不可缺少的結論、理由、要件、例外及關鍵事實。另輸出考試重點、重要爭點、常見錯誤、來源頁碼或原文位置、標籤，以及 3 至 8 張問答複習卡，作為預設收合的補充資料。若不是法律教材，也請依實際內容整理，不要假設它是法律。`;
    const payload = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { ...(await openAIHeaders(true)) }, body: JSON.stringify({
        model,
        instructions: "你是台灣司律考試的教材整理助手。只能根據使用者提供的檔案整理，不得補造檔案沒有的法律結論。若文字或圖片模糊、內容不足或無法確認，必須明確標示待確認。請保留法條編號、判決字號、學說／實務區分、要件、例外、案例與來源頁碼。輸出要能直接用來理解、複習與寫申論，不要寫成空泛的漂亮文章。",
        input: [{ role: "user", content: [
          ...content,
          { type: "input_text", text: prompt },
        ] }],
        text: { format: { type: "json_schema", name: "student_summary", strict: true, schema: {
          type: "object", additionalProperties: false,
          properties: {
            summary: { type: "string" }, examFocus: { type: "string" }, keyPoints: { type: "array", items: { type: "string" } }, issueOutline: { type: "array", items: { type: "string" } }, commonMistakes: { type: "array", items: { type: "string" } }, sourceNotes: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } }, flashcards: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
          }, required: ["summary", "examFocus", "keyPoints", "issueOutline", "commonMistakes", "sourceNotes", "tags", "flashcards"],
        } } },
        max_output_tokens: 9000,
      }) });
    const result = await payload.json() as Record<string, unknown>;
    if (!payload.ok) throw new Error(result.error && typeof result.error === "object" ? String((result.error as Record<string, unknown>).message ?? "AI 整理失敗") : "AI 整理失敗");
    const parsed = parseJson(responseText(result));
    if (!parsed) throw new Error("AI 回傳格式無法辨識，原始檔案已保留");
    const usage = result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {};
    const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
    const cachedTokens = Number((usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? usage.cachedTokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    const saved = { ...parsed, topic, editedSummary: "", favorite: false, title: document.fileName, fontSize: 20, model, billing: { status: "not-enabled", points: 0 }, usage: { inputTokens, cachedTokens, outputTokens, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } };
    await db.update(documents).set({ status: "completed", processingStage: "completed", processingMessage: "已完成摘要、考點、爭點與複習卡整理", processingResultJson: JSON.stringify(saved), tagsJson: JSON.stringify(Array.isArray(parsed.tags) ? parsed.tags : []), processedAt: new Date(), indexError: null }).where(eq(documents.id, documentId));
    await db.insert(usageLogs).values({ model, source: "整摘要｜教材整理", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    return Response.json({ status: "completed", model, usage: { inputTokens, cachedTokens, outputTokens, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    const message = processingError(error);
    if (documentId) await (async () => { try { const db = await getDb(); await db.update(documents).set({ status: "failed", processingStage: "failed", processingMessage: message, indexError: message }).where(eq(documents.id, documentId)); } catch { /* preserve original error */ } })();
    return Response.json({ status: "failed", error: message }, { status: 500 });
  }
}
