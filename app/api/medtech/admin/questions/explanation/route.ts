import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { examQuestions, usageLogs } from "../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../lib/member-auth";
import { getOpenAIModel, openAIJson } from "../../../../../../lib/openai";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text.trim();
  }
  return "";
}

function plain(value: string) {
  return String(value ?? "").replace(/<br\s*\/?>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; force?: boolean; mode?: "ai" | "voiceScript" };
  const mode = body.mode === "voiceScript" ? "voiceScript" : "ai";
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const db = await getDb();
  const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech"))).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
  const existingVoiceScript = question.voiceScript.trim();
  if ((mode === "ai" ? question.aiCompleteExplanation.trim() : existingVoiceScript) && !body.force) return Response.json({ item: question, skipped: true });
  const answer = question.teacherAnswer?.trim() || question.correctAnswer?.trim() || "";
  if (!answer) return Response.json({ error: "本題尚未設定正確答案，請先補上答案再產生解析" }, { status: 422 });
  const options = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
  const model = await getOpenAIModel("gpt-5.6-luna");
  const voiceScriptPrompt = mode === "voiceScript";
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: voiceScriptPrompt
        ? "你是台灣醫事檢驗師國考的語音教材編輯。請把題目、選項、正確答案、原稿解析與 AI 完整解析整理成獨立的『語音解析腳本』，供老師錄音或文字轉語音使用。這不是老師完整解析欄，也不是 AI 解析欄；不要提到 AI、系統、資料庫或生成過程。腳本要可以直接朗讀：先念出題號與正確答案，再用自然口語說明判斷重點，接著逐項說明 A 到 D，最後整理記憶重點。不要使用 Markdown 星號、表格、項目符號或過度書面化標題；可用『第一個選項』『第二個選項』等適合朗讀的說法。只能依題目、選項、答案與既有解析說明，不得補造題目沒有的條件；不確定時請說『依目前題幹可確認』並保留核對空間。"
        : "你是台灣醫事檢驗師國考的資深老師。請依題目與四個選項，寫一段繁體中文的 AI 完整解析草稿，供老師審閱後再發布。不要把內容寫入題目原有的『解析（題目原稿簡要解析）』，也不要假裝這是老師已確認的版本。只能依題目與已知正確答案說明，不得補造題目沒有的條件；不得把不確定內容寫成確定事實。解析要包含：先說正確答案與判斷重點、逐項說明 A 到 D 為何正確或錯誤、補充必要的醫學／檢驗原理、最後用一句話整理記憶重點。語氣自然、清楚、像老師講解；不要使用 Markdown 星號、表格或『AI 生成』字樣。若題目資訊不足，明確寫『依目前題幹可確認』並提醒老師核對。",
      input: `科目：${question.subject}\n年份：${question.year}\n題號：${question.questionNumber}\n題幹：${plain(question.stem)}\n選項：${JSON.stringify(Object.fromEntries(Object.entries(options).map(([key, value]) => [key, plain(value)])))}\n正確答案：${answer}\n題目原有簡要解析（僅供參考，不要覆蓋）：${plain(question.explanation) || "無"}\nAI 完整解析草稿（老師語音版可參考）：${plain(question.aiCompleteExplanation) || "尚無"}`,
      text: { format: { type: "json_schema", name: voiceScriptPrompt ? "medtech_voice_script" : "medtech_complete_explanation", strict: true, schema: { type: "object", additionalProperties: false, properties: { completeExplanation: { type: "string" } }, required: ["completeExplanation"] } } },
      max_output_tokens: 1800,
    }),
  });
  let parsed: { completeExplanation?: string } = {};
  try { parsed = JSON.parse(outputText(payload)) as { completeExplanation?: string }; } catch { /* handled below */ }
  const completeExplanation = String(parsed.completeExplanation ?? "").trim();
  if (completeExplanation.length < 30) return Response.json({ error: "AI 沒有產生可用的完整解析，請稍後重試" }, { status: 502 });
  const [updated] = await db.update(examQuestions).set({
    ...(voiceScriptPrompt ? { voiceScript: completeExplanation } : { aiCompleteExplanation: completeExplanation }),
    answerSource: question.answerSource || (voiceScriptPrompt ? "AI 產生語音解析腳本，待老師核對" : "AI 產生，待老師核對"),
    answerStatus: question.answerStatus === "missing" ? "ai_generated" : question.answerStatus,
    reviewStatus: "pending",
    reviewedAt: null,
    ...(question.status === "published" ? { status: "disabled" } : {}),
  }).where(eq(examQuestions.id, question.id)).returning();
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
  await db.insert(usageLogs).values({
    model,
    source: `醫檢師${voiceScriptPrompt ? "語音解析腳本" : "AI 完整解析"}｜題目 ${question.id}`,
    inputTokens: usage.input_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    fileSearchCalls: 0,
    estimatedCostUsdMicros: 0,
  }).catch(() => undefined);
  return Response.json({ item: updated, generated: true, mode, model, usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } });
}
