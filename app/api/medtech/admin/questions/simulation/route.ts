import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { examQuestions, usageLogs } from "../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../lib/member-auth";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../../../../lib/openai";
import { sanitizeRichHtml } from "../../../../../../lib/rich-html";

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
  return String(value ?? "").replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; force?: boolean };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定。" }, { status: 503 });

  const db = await getDb();
  const [question] = await db.select().from(examQuestions).where(and(
    eq(examQuestions.id, id),
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
  )).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢選擇題" }, { status: 404 });
  if (question.simulatedAnswer.trim() && question.simulatedExplanation.trim() && question.simulatedCompleteExplanation.trim() && !body.force) {
    return Response.json({ item: question, skipped: true });
  }

  const options = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
  const teacherAnswer = String(question.teacherAnswer || question.correctAnswer || "").trim().toUpperCase();
  const hasTeacherAnswer = /^[A-D]$/.test(teacherAnswer);
  const model = await getOpenAIModel("gpt-5.6-luna");
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: `你是台灣醫事檢驗師國考的獨立擬答模型。請先依醫學與檢驗原理獨立判斷答案，再寫出可供老師核對的解析。${hasTeacherAnswer ? `本題目前已有老師／既有答案「${teacherAnswer}」，只能作為比對對象，不得為了迎合它而改變你的獨立判斷；若不同，必須在 simulatedSource 明確寫出「AI 與老師答案不同，需人工確認」，並說明差異原因。` : "本題目前沒有老師答案，請保留待校對狀態。"}絕對不要把推論說成官方答案，也不要捏造法規、研究、教材頁碼或外部來源。輸出的 simulatedAnswer 只能是 A、B、C、D 其中一個；simulatedExplanation 是簡短的模擬解析；simulatedCompleteExplanation 是口語、完整、可供老師修改與日後錄音的完整解析，應包含判斷關鍵與逐項說明 A 到 D；simulatedSource 固定說明依據、不確定性，以及有答案衝突時的警告。所有文字使用繁體中文，不使用 Markdown 表格、星號或『AI 生成』字樣。`,
      input: `科目：${question.subject}\n年份：${question.year}\n題號：${question.questionNumber}\n題幹：${plain(question.stem)}\n選項：${JSON.stringify(Object.fromEntries(Object.entries(options).map(([key, value]) => [key, plain(value)])))}\n老師／既有答案（僅供比對）：${hasTeacherAnswer ? teacherAnswer : "尚未設定"}\n題目原有簡要解析（僅供參考，不能視為標準答案）：${plain(question.explanation) || "無"}`,
      text: { format: { type: "json_schema", name: "medtech_simulated_answer", strict: true, schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          simulatedAnswer: { type: "string", enum: ["A", "B", "C", "D"] },
          simulatedExplanation: { type: "string" },
          simulatedCompleteExplanation: { type: "string" },
          simulatedSource: { type: "string" },
        },
        required: ["simulatedAnswer", "simulatedExplanation", "simulatedCompleteExplanation", "simulatedSource"],
      } } },
      max_output_tokens: 2400,
    }),
  });
  let parsed: { simulatedAnswer?: string; simulatedExplanation?: string; simulatedCompleteExplanation?: string; simulatedSource?: string } = {};
  try { parsed = JSON.parse(outputText(payload)) as typeof parsed; } catch { /* handled below */ }
  const simulatedAnswer = String(parsed.simulatedAnswer ?? "").trim().toUpperCase();
  const simulatedExplanation = String(parsed.simulatedExplanation ?? "").trim();
  const simulatedCompleteExplanation = String(parsed.simulatedCompleteExplanation ?? "").trim();
  const simulatedSource = String(parsed.simulatedSource ?? "依題幹與選項推論，待老師核對").trim();
  if (!/^[A-D]$/.test(simulatedAnswer) || simulatedExplanation.length < 15 || simulatedCompleteExplanation.length < 40) {
    return Response.json({ error: "AI 沒有產生完整的模擬答案與解析，請稍後重試。" }, { status: 502 });
  }

  const [updated] = await db.update(examQuestions).set({
    simulatedAnswer,
    simulatedExplanation: sanitizeRichHtml(simulatedExplanation),
    simulatedCompleteExplanation: sanitizeRichHtml(simulatedCompleteExplanation),
    aiCompleteExplanation: sanitizeRichHtml(simulatedCompleteExplanation),
    simulatedSource: sanitizeRichHtml(simulatedSource),
    simulatedAnswerStatus: hasTeacherAnswer ? (simulatedAnswer === teacherAnswer ? "ai_correct" : "conflict_pending") : "pending_review",
    reviewStatus: "pending",
    reviewedAt: null,
    ...(question.status === "published" ? { status: "disabled" } : {}),
  }).where(eq(examQuestions.id, question.id)).returning();
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
  await db.insert(usageLogs).values({
    model,
    source: `醫檢師擬真題 AI 擬答｜題目 ${question.id}`,
    inputTokens: usage.input_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    fileSearchCalls: 0,
    estimatedCostUsdMicros: 0,
  }).catch(() => undefined);
  return Response.json({ item: updated, generated: true, answerConflict: hasTeacherAnswer && simulatedAnswer !== teacherAnswer, model, usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } });
}
