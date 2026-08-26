import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSearchUnits, documents, usageLogs } from "../../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../../lib/usage";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { requireMember } from "../../../../../lib/member-auth";
import { finishAiCoachRound, prepareAiUse } from "../../../../../lib/ai-access-gate";

type InputMessage = { role?: unknown; text?: unknown };

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function plainText(value: string) {
  return value.replace(/\*\*/gu, "").replace(/^#{1,6}\s*/gmu, "").replace(/^>\s?/gmu, "").trim();
}

function coachParts(value: string) {
  const cleaned = plainText(value);
  const marker = cleaned.match(/【學霸追問】/u);
  return {
    coach: plainText(cleaned.replace(/【教練回應】/gu, "").slice(0, marker?.index ?? cleaned.length)),
    scholar: marker ? plainText(cleaned.slice((marker.index ?? 0) + marker[0].length)) : "",
  };
}

async function pengliEvidence(query: string) {
  const db = await getDb("primary");
  const [book] = await db.select({ id: documents.id, title: documents.bookTitle })
    .from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true)))
    .orderBy(desc(documents.id)).limit(1);
  if (!book) return { documentId: null, title: "", rows: [] as Array<{ pageStart: number | null; pageEnd: number | null; text: string }> };
  const terms = [...new Set(query.normalize("NFKC").split(/[\s、，。；：,.;:()（）？?！!]+/u).map((term) => term.trim()).filter((term) => term.length >= 2))].slice(0, 8);
  const rows = terms.length ? await db.select({ pageStart: documentSearchUnits.pageStart, pageEnd: documentSearchUnits.pageEnd, text: documentSearchUnits.text })
    .from(documentSearchUnits)
    .where(and(eq(documentSearchUnits.documentId, book.id), or(...terms.map((term) => like(documentSearchUnits.normalizedText, `%${term.toLocaleLowerCase("zh-Hant")}%`)))))
    .orderBy(documentSearchUnits.sequence).limit(8) : [];
  return { documentId: book.id, title: book.title || "行政法考點演習書（二版）｜彭狸", rows };
}

const teacherContext = `
【專屬教材】彭狸，《行政法考點（考前衝刺）演習書》，2026年二版。
【教材結構】行政法理論基礎與行政組織法、行政處分、行政契約與行政命令、行政罰法、行政執行法、訴願法與行政訴訟法、國家賠償法與損失補償、新進實務見解整理。
【目前已核對試學範圍】
1. 公私法區分：法律條文性質可由新主體說判斷；事件性質需先看原告主張的請求權基礎。釋字第758號指出，依民法第767條請求返還土地，原則上屬私法爭議，即使被告以公法關係抗辯亦不改變。老師提醒：這是基本功但不是考試熱區，先熟悉新主體說與釋字第758號。
2. 法律保留原則：以釋字第443號的層級化法律保留為核心；依人身自由、其他自由權利、技術細節與重大給付行政事項調整規範密度。地方自治事項另注意自治條例與釋字第806號。
3. 明確性原則：概念容許解釋不當然違反明確性；應從受規範者可理解、可預見及可經司法審查等方向說明。
`;

export async function POST(request: Request) {
  try {
    const auth = await requireMember(request);
    if ("error" in auth) return auth.error;
    const gate = await prepareAiUse(request, "pengli");
    if (gate instanceof Response) return gate;
    if (!await getOpenAIKey()) return Response.json({ error: "彭狸 AI 教練尚未設定模型。" }, { status: 503 });
    const body = await request.json() as { messages?: InputMessage[]; requestKey?: string };
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-12).map((message) => ({
      role: message.role === "coach" || message.role === "scholar" ? "assistant" : "user",
      content: String(message.text ?? "").slice(0, 4000),
    })).filter((message) => message.content.trim());
    if (!messages.length) return Response.json({ error: "請先輸入行政法問題。" }, { status: 400 });
    const latestQuestion = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const evidence = await pengliEvidence(latestQuestion);
    const evidenceText = evidence.rows.length ? evidence.rows.map((row, index) => `【教材片段 ${index + 1}｜本書第 ${row.pageStart ?? "?"}${row.pageEnd && row.pageEnd !== row.pageStart ? `–${row.pageEnd}` : ""} 頁】\n${row.text.slice(0, 1800)}`).join("\n\n") : "目前未從彭狸專屬教材精準命中，不得假稱教材有記載。";
    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是「彭狸 AI 教練」，是依彭狸老師教材建立的 AI 分身，不是真人老師。只能服務臺灣行政法考試學習，不得引用或混用其他司律老師教材。只以本次提供的彭狸專屬教材片段作為教材依據。回答精簡、口語，一次只教一個判斷步驟；先問一個問題讓學生回答，不要一次傾倒完整擬答。接著模擬一位程度很好的「AI 學霸」，從學生容易忽略的反面、例外或事實變化提出一個短追問。禁止使用 Markdown 符號（包括 **、#、>）。引用教材時必須在句末標示「依據：行政法考點演習書（二版），本書第 X–X 頁」。沒有命中教材就明說「本輪未命中彭狸教材」，不得自行編造頁碼、老師原文、裁判或法條。輸出固定分成【教練回應】與【學霸追問】兩段，學霸只問一題。\n${teacherContext}\n\n【本輪專屬教材檢索】\n${evidenceText}`,
      input: messages,
      max_output_tokens: 1200,
    }) }) as Record<string, unknown>;
    const parts = coachParts(outputText(payload));
    if (!parts.coach) return Response.json({ error: "彭狸 AI 教練沒有產生可顯示的回答。" }, { status: 502 });
    const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(rawUsage.input_tokens ?? 0);
    const cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(rawUsage.output_tokens ?? 0);
    const costMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    try { const db = await getDb(); await db.insert(usageLogs).values({ model, source: "彭狸老師專區｜AI 分身教練", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: costMicros }); } catch { /* 回答不因成本紀錄失敗而中斷 */ }
    const access = await finishAiCoachRound(gate, { action: "pengli_coach_5_rounds", description: "彭狸 AI 分身陪練，每 5 輪扣 1 次", requestKey: String(body.requestKey ?? crypto.randomUUID()) });
    const source = evidence.rows.length ? `${evidence.title}｜教材 #${evidence.documentId}` : "本輪未命中彭狸教材";
    return Response.json({ reply: parts.coach, scholar: parts.scholar, source, access, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "彭狸 AI 教練目前無法回答。" }, { status: 500 });
  }
}
