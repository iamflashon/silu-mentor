import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { examAttempts, examQuestions, studyRecords, usageLogs } from "../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "") : []).join("").trim();
}

function parseRubric(raw: string) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY 尚未設定" }, { status: 503 });
    const body = await request.json() as { questionId?: number; answer?: string };
    const questionId = Number(body.questionId);
    const answer = String(body.answer ?? "").trim();
    if (!Number.isInteger(questionId) || !answer) return Response.json({ error: "請提供題目與申論作答內容" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examType, "essay"), eq(examQuestions.status, "published"))).limit(1);
    if (!question) return Response.json({ error: "找不到已發布的二試申論題" }, { status: 404 });
    if (!question.teacherAnswer.trim()) return Response.json({ error: "這題尚未完成老師擬答核對，暫不能進行依擬答批改。" }, { status: 409 });
    const rubric = parseRubric(question.rubricJson);
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({
      model: process.env.OPENAI_ESSAY_GRADING_MODEL || "gpt-5.6-sol",
      instructions: `你是台灣司律二試申論閱卷教練。必須以「高點名師參考擬答」及其明確評分重點作為主要核對依據，但不能用文字相似度代替法律評價。請檢查學生是否審對題目、列出關鍵爭點、使用正確規範、完成事實涵攝、提出結論，並檢查架構與表達。老師擬答是參考解答，不是唯一文字答案；學生採不同但有法律理由的見解時，應標示為可接受或需補強，不要直接判錯。只根據題目、老師擬答與提供的評分點，不能補造未提供的老師見解。回覆繁體中文，分項指出學生原文證據、漏寫點與下一個修正動作。`,
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ question: question.stem, teacher_answer: question.teacherAnswer, teacher_notes: question.teacherNotes, rubric, student_answer: answer }, null, 2) }] }],
      text: { format: { type: "json_schema", name: "essay_grading", strict: true, schema: { type: "object", additionalProperties: false, properties: { score: { type: "integer" }, overall: { type: "string" }, dimensions: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterion: { type: "string" }, score: { type: "integer" }, max_score: { type: "integer" }, result: { type: "string" }, evidence: { type: "string" }, missing: { type: "string" } }, required: ["criterion", "score", "max_score", "result", "evidence", "missing"] } }, strengths: { type: "array", items: { type: "string" } }, priority_fixes: { type: "array", items: { type: "string" } }, next_step: { type: "string" }, source_used: { type: "string" } }, required: ["score", "overall", "dimensions", "strengths", "priority_fixes", "next_step", "source_used"] } } },
      max_output_tokens: 12000,
    }) });
    const payload = await response.json() as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; error?: { message?: string } };
    if (!response.ok) return Response.json({ error: payload.error?.message ?? "AI 申論批改失敗" }, { status: 502 });
    const grading = JSON.parse(responseText(payload)) as { score: number; overall: string; dimensions: Array<{ criterion: string; score: number; max_score: number; result: string; evidence: string; missing: string }>; strengths: string[]; priority_fixes: string[]; next_step: string; source_used: string };
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId, selectedAnswer: null, correct: null, answerText: answer, gradingJson: JSON.stringify(grading) });
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: date, subject: question.subject, title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "二試申論批改", correct: null, reflection: grading.overall.slice(0, 1000), weakness: grading.priority_fixes.join("；").slice(0, 500), nextStep: grading.next_step.slice(0, 500) });
    const input = Number(payload.usage?.input_tokens ?? 0); const output = Number(payload.usage?.output_tokens ?? 0); const cached = Number(payload.usage?.input_tokens_details?.cached_tokens ?? 0);
    await db.insert(usageLogs).values({ model: process.env.OPENAI_ESSAY_GRADING_MODEL || "gpt-5.6-sol", source: "二試申論批改", inputTokens: input, cachedTokens: cached, outputTokens: output, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(((Math.max(0, input - cached) * 2.5 + cached * .25 + output * 15) / 1_000_000) * 1_000_000) });
    return Response.json({ grading, source: { label: question.answerSource || "高點名師參考擬答", status: question.answerStatus } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI 申論批改失敗" }, { status: 500 });
  }
}
