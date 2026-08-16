import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { examQuestions, usageLogs } from "../../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../../lib/member-auth";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../../../../../lib/openai";
import { sanitizeRichHtml } from "../../../../../../../lib/rich-html";

function plain(value: string) {
  return String(value ?? "").replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text.trim();
  }
  return "";
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; action?: "investigate" | "teacherDecision"; decision?: "keep_teacher" | "use_ai" | "pending"; correctAnswer?: string; teacherNote?: string };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const db = await getDb();
  const [question] = await db.select().from(examQuestions).where(and(
    eq(examQuestions.id, id),
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
  )).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢選擇題" }, { status: 404 });
  const currentTeacherAnswer = String(question.teacherAnswer || question.correctAnswer || "").trim().toUpperCase();
  const currentAiAnswer = String(question.simulatedAnswer || "").trim().toUpperCase();

  if (body.action === "investigate") {
    if (!/^[A-D]$/.test(currentTeacherAnswer) || !/^[A-D]$/.test(currentAiAnswer)) return Response.json({ error: "必須同時有老師答案與 AI 答案，才能調查差異。" }, { status: 422 });
    if (currentTeacherAnswer === currentAiAnswer) return Response.json({ error: "目前老師答案與 AI 答案相同，沒有需要調查的差異。" }, { status: 422 });
    if (!await getOpenAIKey()) return Response.json({ error: "醫檢 AI 模型尚未設定，暫時無法調查答案差異。" }, { status: 503 });
    const options = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
    const model = await getOpenAIModel("gpt-5.6-luna");
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "你是台灣醫事檢驗師國考的答案差異覆核員。題目同時有老師答案與 AI 獨立答案，兩者不同。請不要直接服從老師，也不要直接服從 AI；必須重新依題幹、選項與醫學原理判斷哪一個較合理。這只是提供老師覆核的調查報告，不得自動改寫正式答案。若題目或教材有歧義，請明確標示 ambiguous。所有文字使用繁體中文，不使用 Markdown 表格或星號。",
        input: `科目：${question.subject}\n年份：${question.year}\n題號：${question.questionNumber}\n題幹：${plain(question.stem)}\n選項：${JSON.stringify(Object.fromEntries(Object.entries(options).map(([key, value]) => [key, plain(value)])))}\n老師答案：${currentTeacherAnswer}\nAI 答案：${currentAiAnswer}\nAI 簡要解析：${plain(question.simulatedExplanation)}\nAI 完整解析：${plain(question.simulatedCompleteExplanation || question.aiCompleteExplanation)}`,
        text: { format: { type: "json_schema", name: "medtech_answer_conflict_review", strict: true, schema: { type: "object", additionalProperties: false, properties: { recommendation: { type: "string", enum: ["teacher", "ai", "ambiguous"] }, reason: { type: "string" } }, required: ["recommendation", "reason"] } } },
        max_output_tokens: 1000,
      }),
    });
    let parsed: { recommendation?: "teacher" | "ai" | "ambiguous"; reason?: string } = {};
    try { parsed = JSON.parse(outputText(payload)) as typeof parsed; } catch { /* handled below */ }
    const recommendation = parsed.recommendation;
    const reason = String(parsed.reason || "AI 未能完成答案差異調查，請老師人工核對。").trim();
    if (!recommendation || reason.length < 10) return Response.json({ error: "AI 未能產生可用的答案差異調查，請稍後重試。" }, { status: 502 });
    const note = `答案差異調查：老師 ${currentTeacherAnswer}／AI ${currentAiAnswer}；AI 建議：${recommendation === "teacher" ? "暫維持老師答案" : recommendation === "ai" ? "優先檢查 AI 答案" : "題目可能有歧義"}。${reason}`;
    const [updated] = await db.update(examQuestions).set({ simulatedAnswerStatus: "conflict_pending", simulatedTeacherNote: sanitizeRichHtml(note) }).where(eq(examQuestions.id, id)).returning();
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    await db.insert(usageLogs).values({ model, source: `醫檢師答案差異調查｜題目 ${question.id}`, inputTokens: usage.input_tokens ?? 0, cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 }).catch(() => undefined);
    return Response.json({ item: updated, conflict: { teacherAnswer: currentTeacherAnswer, aiAnswer: currentAiAnswer, recommendation, reason }, model, usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } });
  }

  if (body.action === "teacherDecision") {
    if (!body.decision || !["keep_teacher", "use_ai", "pending"].includes(body.decision)) return Response.json({ error: "缺少老師確認結果。" }, { status: 400 });
    if (body.decision === "use_ai" && !/^[A-D]$/.test(currentAiAnswer)) return Response.json({ error: "目前沒有可採用的 AI 答案。" }, { status: 422 });
    const answer = body.decision === "use_ai" ? currentAiAnswer : currentTeacherAnswer;
    if (!/^[A-D]$/.test(answer)) return Response.json({ error: "老師答案必須是 A、B、C 或 D。" }, { status: 422 });
    const decisionText = body.decision === "use_ai" ? `老師確認採用 AI 答案 ${currentAiAnswer}` : body.decision === "keep_teacher" ? `老師確認維持老師答案 ${currentTeacherAnswer}` : "老師暫不決定，保留答案差異";
    const [updated] = await db.update(examQuestions).set({
      ...(body.decision === "use_ai" ? { correctAnswer: currentAiAnswer, teacherAnswer: currentAiAnswer, answerStatus: "teacher_confirmed" } : {}),
      simulatedAnswerStatus: body.decision === "pending" ? "conflict_pending" : body.decision === "use_ai" ? "teacher_confirmed" : "teacher_confirmed",
      simulatedTeacherNote: sanitizeRichHtml(`${String(question.simulatedTeacherNote || "").trim()}\n${decisionText}。${String(body.teacherNote || "").trim()}`.trim()),
      reviewStatus: "pending",
      reviewedAt: null,
      ...(question.status === "published" ? { status: "disabled" } : {}),
    }).where(eq(examQuestions.id, id)).returning();
    return Response.json({ item: updated, aiAccuracy: updated.simulatedAnswer === updated.teacherAnswer ? "correct" : "incorrect", decision: body.decision });
  }

  const correctAnswer = String(body.correctAnswer ?? "").trim().toUpperCase();
  if (!/^[A-D]$/.test(correctAnswer)) return Response.json({ error: "老師批改答案必須是 A、B、C 或 D" }, { status: 400 });
  const aiAccuracy = question.simulatedAnswer ? (question.simulatedAnswer === correctAnswer ? "ai_correct" : "ai_incorrect") : "pending_review";
  const [updated] = await db.update(examQuestions).set({
    correctAnswer,
    teacherAnswer: correctAnswer,
    answerStatus: "teacher_confirmed",
    simulatedAnswerStatus: aiAccuracy,
    simulatedTeacherNote: sanitizeRichHtml(String(body.teacherNote ?? "").trim()),
    reviewStatus: "pending",
    reviewedAt: null,
    ...(question.status === "published" ? { status: "disabled" } : {}),
  }).where(eq(examQuestions.id, id)).returning();
  return Response.json({ item: updated, aiAccuracy });
}
