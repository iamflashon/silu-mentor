import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { personalIssuePracticeRecords, personalIssueQuestions, studyRecords, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { taipeiDate } from "../../../../lib/taipei-time";

function owner(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}
function usage(payload: Record<string, unknown>) {
  const value = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  return { inputTokens: Number(value.input_tokens ?? 0), outputTokens: Number(value.output_tokens ?? 0), cachedTokens: Number(value.input_tokens_details?.cached_tokens ?? 0) };
}
function imageData(value: unknown) {
  const match = String(value ?? "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return bytes.byteLength <= 8_000_000 ? { contentType: match[1], bytes } : null;
}
async function userHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parseResult(value: string | null) { try { return value ? JSON.parse(value) as unknown : null; } catch { return null; } }
function parseStrings(value: string | null | undefined) { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") || 0);
    const imageId = Number(url.searchParams.get("imageId") || 0);
    if (imageId > 0) {
      const [row] = await db.select().from(personalIssueQuestions).where(and(eq(personalIssueQuestions.id, imageId), eq(personalIssueQuestions.userKey, owner(request)))).limit(1);
      const imageIndex = Math.max(0, Math.min(1, Number(url.searchParams.get("imageIndex") || 0)));
      const storageKeys = parseStrings(row?.imageStorageKeysJson); const contentTypes = parseStrings(row?.imageContentTypesJson);
      const storageKey = storageKeys[imageIndex] || (imageIndex === 0 ? row?.imageStorageKey : null);
      if (!row || !storageKey) return new Response("Not found", { status: 404 });
      const { env } = await import("cloudflare:workers");
      const object = await env.BUCKET.get(storageKey);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "content-type": contentTypes[imageIndex] || row.imageContentType || "image/jpeg", "cache-control": "private, max-age=3600" } });
    }
    if (id > 0) {
      const [question] = await db.select().from(personalIssueQuestions).where(and(eq(personalIssueQuestions.id, id), eq(personalIssueQuestions.userKey, owner(request)))).limit(1);
      if (!question) return Response.json({ error: "找不到這筆個人題目" }, { status: 404 });
      const [record] = await db.select().from(personalIssuePracticeRecords).where(and(eq(personalIssuePracticeRecords.personalQuestionId, id), eq(personalIssuePracticeRecords.userKey, owner(request)))).limit(1);
      const imageKeys = parseStrings(question.imageStorageKeysJson); const imageCount = imageKeys.length || (question.imageStorageKey ? 1 : 0);
      return Response.json({ question: { ...question, imageStorageKeysJson: undefined, imageContentTypesJson: undefined, ocrPartsJson: undefined, imageUrl: imageCount ? `/api/issue-practice/personal?imageId=${question.id}&imageIndex=0` : null, imageUrls: Array.from({ length: imageCount }, (_, index) => `/api/issue-practice/personal?imageId=${question.id}&imageIndex=${index}`) }, record: record ? { ...record, aiResult: parseResult(record.aiResultJson), aiResultJson: undefined } : null });
    }
    const keyword = String(url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const subject = String(url.searchParams.get("subject") ?? "").trim().slice(0, 50);
    const conditions = [eq(personalIssueQuestions.userKey, owner(request))];
    if (subject && subject !== "全部") conditions.push(eq(personalIssueQuestions.subject, subject));
    if (keyword) conditions.push(or(like(personalIssueQuestions.title, `%${keyword}%`), like(personalIssueQuestions.questionText, `%${keyword}%`))!);
    const questions = await db.select().from(personalIssueQuestions).where(and(...conditions)).orderBy(desc(personalIssueQuestions.updatedAt)).limit(100);
    return Response.json({ questions: questions.map((question) => ({ ...question, imageStorageKey: undefined, imageContentType: undefined, imageStorageKeysJson: undefined, imageContentTypesJson: undefined, ocrPartsJson: undefined, preview: question.questionText.replace(/\s+/gu, " ").slice(0, 80) })) });
  } catch { return Response.json({ error: "我的拍照題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "ocr" | "save" | "suggest" | "analyze"; imageDataUrl?: string; imageDataUrls?: string[]; ocrParts?: string[]; title?: string; subject?: string; sourceLabel?: string; questionText?: string; personalQuestionId?: number; studentIssues?: string };
    if (body.action === "ocr") {
      const urls = (Array.isArray(body.imageDataUrls) ? body.imageDataUrls : body.imageDataUrl ? [body.imageDataUrl] : []).slice(0, 2);
      const images = urls.map(imageData);
      if (!images.length || images.some((image) => !image)) return Response.json({ error: "圖片格式不正確、超過 8MB，或超過 2 張" }, { status: 400 });
      if (!await getOpenAIKey()) return Response.json({ error: "AI 圖片辨識尚未設定" }, { status: 503 });
      const model = "gpt-5.6-luna";
      const started = Date.now();
      const payloads = await Promise.all(urls.map((url, index) => openAIJson("/responses", {
        method: "POST",
        body: JSON.stringify({ model, instructions: "你是繁體中文法律題目 OCR 校對員。只轉錄圖片中實際可見的文字，保留段落、題號、人物代號、標點與法條號碼。不得解題、摘要、改寫、補造被裁掉或看不清的內容；無法辨識處標成〔辨識不清〕。若頁首或頁尾疑似與另一張重複，仍須照實轉錄並在該段前標〔疑似重複〕，不得自行刪除。只輸出轉錄文字。", input: [{ role: "user", content: [{ type: "input_text", text: `這是依序排列的第 ${index + 1} 張（共 ${urls.length} 張）。請只忠實轉錄本張。` }, { type: "input_image", image_url: url, detail: "high" }] }], max_output_tokens: 5000 }),
      }))) as Record<string, unknown>[];
      const parts = payloads.map(outputText); if (parts.some((text) => !text)) return Response.json({ error: "其中一張沒有辨識出可確認的文字，請重拍清楚一點" }, { status: 422 });
      const text = parts.map((part, index) => urls.length > 1 ? `【第 ${index + 1} 張】\n${part}` : part).join("\n\n");
      const tokens = payloads.map(usage).reduce((sum, item) => ({ inputTokens: sum.inputTokens + item.inputTokens, outputTokens: sum.outputTokens + item.outputTokens, cachedTokens: sum.cachedTokens + item.cachedTokens }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }); const estimatedCostUsd = tokens.inputTokens / 1e6 * .105 + tokens.outputTokens / 1e6 * .63;
      const db = await getDb();
      await db.insert(usageLogs).values({ source: "找爭點／拍照OCR", model, ...tokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
      return Response.json({ text, parts, model, usage: { ...tokens, estimatedCostUsd, durationMs: Date.now() - started } });
    }
    const db = await getDb();
    if (body.action === "save") {
      const images = (Array.isArray(body.imageDataUrls) ? body.imageDataUrls : body.imageDataUrl ? [body.imageDataUrl] : []).slice(0, 2).map(imageData).filter((image): image is NonNullable<ReturnType<typeof imageData>> => Boolean(image));
      const questionText = String(body.questionText ?? "").trim().slice(0, 24000);
      if (questionText.length < 10) return Response.json({ error: "請先確認並修正辨識文字" }, { status: 400 });
      const subject = String(body.subject ?? "未分類").trim().slice(0, 50) || "未分類";
      const title = String(body.title ?? "").trim().slice(0, 160) || questionText.replace(/\s+/gu, " ").slice(0, 32);
      const [created] = await db.insert(personalIssueQuestions).values({ userKey: owner(request), title, subject, sourceLabel: String(body.sourceLabel ?? "我的書籍").trim().slice(0, 120) || "我的書籍", questionText, imageContentType: images[0]?.contentType ?? null, ocrPartsJson: JSON.stringify((body.ocrParts || []).slice(0, 2).map((part) => String(part).slice(0, 12000))), updatedAt: new Date() }).returning();
      const storageKeys: string[] = [];
      if (images.length) {
        const { env } = await import("cloudflare:workers");
        for (const [index, image] of images.entries()) { const storageKey = `personal-issue/${await userHash(owner(request))}/${created.id}-${index + 1}-${crypto.randomUUID()}.jpg`; await env.BUCKET.put(storageKey, image.bytes, { httpMetadata: { contentType: image.contentType } }); storageKeys.push(storageKey); }
        await db.update(personalIssueQuestions).set({ imageStorageKey: storageKeys[0], imageStorageKeysJson: JSON.stringify(storageKeys), imageContentTypesJson: JSON.stringify(images.map((image) => image.contentType)) }).where(eq(personalIssueQuestions.id, created.id));
      }
      return Response.json({ question: { ...created, imageUrl: storageKeys.length ? `/api/issue-practice/personal?imageId=${created.id}&imageIndex=0` : null, imageUrls: storageKeys.map((_, index) => `/api/issue-practice/personal?imageId=${created.id}&imageIndex=${index}`) } });
    }
    if (body.action === "suggest") {
      const id = Number(body.personalQuestionId);
      if (!Number.isInteger(id)) return Response.json({ error: "找不到要分析的題目" }, { status: 400 });
      const [question] = await db.select().from(personalIssueQuestions).where(and(eq(personalIssueQuestions.id, id), eq(personalIssueQuestions.userKey, owner(request)))).limit(1);
      if (!question) return Response.json({ error: "找不到這筆個人題目" }, { status: 404 });
      if (!await getOpenAIKey()) return Response.json({ error: "AI 模型尚未設定" }, { status: 503 });
      const model = "gpt-5.6-luna"; const started = Date.now();
      const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model,
        instructions: "你是臺灣司法官、律師二試的爭點提示助教。只依題目明示事實辨識必要爭點，不得補造事實，也不得直接寫完整解答、涵攝或罪責結論。每個爭點必須指出觸發它的題示事實。輸出 3 至 8 行；每行只能是一個爭點，格式固定為「一、〔對應事實〕行為人之行為是否涉及○○爭點？」並依行為人與事件順序排列。若資訊不足，該行末標示「（待確認）」；不要輸出前言、標題、法條全文或結語。只輸出繁體中文純文字。",
        input: `【科目】${question.subject}\n【同學確認後的題目文字】\n${question.questionText}`,
        max_output_tokens: 1800,
      }) }) as Record<string, unknown>;
      const suggestion = outputText(payload); if (!suggestion) return Response.json({ error: "AI 本次沒有產生爭點提示，請再試一次" }, { status: 502 });
      const tokens = usage(payload); const estimatedCostUsd = tokens.inputTokens / 1e6 * .105 + tokens.outputTokens / 1e6 * .63;
      await db.insert(usageLogs).values({ source: "找爭點／AI 爭點提示", model, ...tokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
      return Response.json({ suggestion, model: "Luna 助教", usage: { ...tokens, estimatedCostUsd, durationMs: Date.now() - started } });
    }
    if (body.action === "analyze") {
      const id = Number(body.personalQuestionId); const studentIssues = String(body.studentIssues ?? "").trim().slice(0, 12000);
      if (!Number.isInteger(id) || studentIssues.length < 10) return Response.json({ error: "請先寫下至少 10 字的爭點" }, { status: 400 });
      const [question] = await db.select().from(personalIssueQuestions).where(and(eq(personalIssueQuestions.id, id), eq(personalIssueQuestions.userKey, owner(request)))).limit(1);
      if (!question) return Response.json({ error: "找不到這筆個人題目" }, { status: 404 });
      if (!await getOpenAIKey()) return Response.json({ error: "AI 模型尚未設定" }, { status: 503 });
      const model = "gpt-5.6-luna"; const started = Date.now();
      const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model,
        instructions: "你是臺灣司法官、律師二試的爭點診斷員。這是學生自行拍攝且已確認文字的題目，沒有平台老師擬答。只依題目事實與現行法獨立分析，不得假稱已與老師答案核對，不得補造事實。依序輸出：一、整體表現；二、已命中的爭點；三、可能遺漏的必要爭點；四、錯抓或過度延伸；五、建議的最終爭點架構。每個判斷都要對應題示事實；有不確定採說時明確標示。只輸出繁體中文純文字，控制在 1400 字內。",
        input: `【同學確認後的題目文字】\n${question.questionText}\n\n【同學寫下的爭點】\n${studentIssues}`,
        max_output_tokens: 5000,
      }) }) as Record<string, unknown>;
      const analysis = outputText(payload); if (!analysis) return Response.json({ error: "AI 本次未完成分析，請再試一次" }, { status: 502 });
      const tokens = usage(payload); const estimatedCostUsd = tokens.inputTokens / 1e6 * .105 + tokens.outputTokens / 1e6 * .63;
      const result = { analysis, model: "Luna 助教", modelId: String(payload.model || model), reason: "本題為個人拍照題目，採 AI 獨立分析，未與平台老師擬答核對", answerSource: "同學確認後的拍照題目", usage: { ...tokens, estimatedCostUsd, durationMs: Date.now() - started } };
      await db.insert(personalIssuePracticeRecords).values({ userKey: owner(request), personalQuestionId: id, studentIssues, aiResultJson: JSON.stringify(result), updatedAt: new Date() }).onConflictDoUpdate({ target: [personalIssuePracticeRecords.userKey, personalIssuePracticeRecords.personalQuestionId], set: { studentIssues, aiResultJson: JSON.stringify(result), updatedAt: new Date() } });
      await db.update(personalIssueQuestions).set({ updatedAt: new Date() }).where(eq(personalIssueQuestions.id, id));
      await db.insert(usageLogs).values({ source: "找爭點／我的拍照題庫", model, ...tokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
      await db.insert(studyRecords).values({ userKey: owner(request), questionId: null, recordDate: taipeiDate(), subject: question.subject, title: `${question.title}｜我的拍照題庫`, activityType: "練爭點", reflection: studentIssues.slice(0, 3000), weakness: "依 AI 獨立分析回補遺漏爭點", nextStep: "回到我的拍照題庫重寫爭點清單" });
      return Response.json(result);
    }
    return Response.json({ error: "不支援的操作" }, { status: 400 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "拍照題目處理失敗" }, { status: 500 }); }
}
