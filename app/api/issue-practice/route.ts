import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, studyRecords, usageLogs } from "../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../lib/openai";
import { taipeiDate } from "../../../lib/taipei-time";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select({ id: examQuestions.id, year: examQuestions.year, examName: examQuestions.examName, subject: examQuestions.subject, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem, answerSource: examQuestions.answerSource }).from(examQuestions).where(and(eq(examQuestions.status, "published"), eq(examQuestions.examType, "essay"), sql`length(trim(${examQuestions.teacherAnswer})) > 0`)).orderBy(sql`${examQuestions.year} desc`, examQuestions.subject, examQuestions.questionNumber).limit(500);
    return Response.json({ questions: rows });
  } catch { return Response.json({ error: "練爭點題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; studentIssues?: string; model?: "luna" | "sol" };
    const questionId = Number(body.questionId); const studentIssues = String(body.studentIssues ?? "").trim(); const requestedModel = body.model === "sol" ? "sol" : "luna";
    if (!Number.isInteger(questionId) || studentIssues.length < 10) return Response.json({ error: "請先寫下你辨識的爭點再送出" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"), eq(examQuestions.examType, "essay"))).limit(1);
    if (!question) return Response.json({ error: "找不到這一題" }, { status: 404 });
    if (!question.teacherAnswer.trim()) return Response.json({ error: "本題尚未完成老師擬答核對，暫不開放 AI 比對" }, { status: 409 });
    if (!await getOpenAIKey()) return Response.json({ error: "AI 模型尚未設定" }, { status: 503 });
    const model = requestedModel === "sol" ? "gpt-5.6-sol" : "gpt-5.6-luna";
    const instructions = `你是臺灣司法官、律師二試的爭點學習助教。比較學生寫的爭點與同一題老師擬答。原始題目是最高依據，老師擬答是主要校準資料，但不得稱為官方唯一答案。不得自行補充題目沒有的事實，不得因用語不同就判定學生錯誤。任務不是寫完整申論，而是診斷爭點辨識。\n固定依下列標題輸出：\n一、整體表現（2至3句，並給爭點辨識完成度0至100分）\n二、已命中的爭點（指出對應題示事實）\n三、遺漏的爭點（依配分重要性排序；沒有則明示）\n四、錯抓或過度延伸（說明欠缺的題示基礎；沒有則明示）\n五、表達可再精準之處（只修正名稱、法條定位或問句）\n六、建議的最終爭點架構（依行為人與行為順序列精簡清單）\n必須區分「未寫到」與「寫錯」，並容許合理不同見解。控制在1400字內。`;
    const input = `【題目】\n${question.stem}\n\n【學生寫下的爭點】\n${studentIssues}\n\n【同題老師擬答／解析】\n${question.teacherAnswer.slice(0, 15000)}`;
    const started = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions, input, max_output_tokens: requestedModel === "sol" ? 2400 : 2000 }) }) as Record<string, unknown>;
    const text = outputText(payload); if (!text) return Response.json({ error: "AI 沒有產生可顯示的分析，請稍後再試" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens ?? 0); const outputTokens = Number(usage.output_tokens ?? 0); const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const inputRate = requestedModel === "sol" ? .525 : .105; const outputRate = requestedModel === "sol" ? 3.15 : .63;
    const estimatedCostUsd = Math.max(0, inputTokens - cachedTokens) / 1e6 * inputRate + cachedTokens / 1e6 * inputRate * .1 + outputTokens / 1e6 * outputRate;
    await db.insert(usageLogs).values({ source: requestedModel === "sol" ? "練爭點／Sol學霸覆核" : "練爭點／Luna助教比對", model: String(payload.model || model), inputTokens, outputTokens, cachedTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: taipeiDate(), subject: question.subject, title: `${question.year} ${question.examName || "司律二試"}第 ${question.questionNumber} 題｜練爭點`, activityType: "練爭點", reflection: studentIssues.slice(0, 3000), weakness: "依 AI 比對結果回補遺漏爭點", nextStep: "依建議架構重寫一次爭點清單" });
    return Response.json({ analysis: text, model: requestedModel === "sol" ? "Sol 學霸" : "Luna 助教", modelId: String(payload.model || model), reason: requestedModel === "sol" ? "學生主動要求強模型覆核 Luna 的判斷" : "本題已精準命中老師擬答，使用低成本模型進行受資料約束的比對", usage: { inputTokens, outputTokens, cachedTokens, estimatedCostUsd, durationMs: Date.now() - started }, answerSource: question.answerSource || "老師參考擬答" });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI 比對暫時無法完成" }, { status: 500 }); }
}
