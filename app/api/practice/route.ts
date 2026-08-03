import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examAttempts, examQuestions, studyRecords } from "../../../db/schema";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const examType = url.searchParams.get("type") === "essay" ? "essay" : "mcq";
    const subject = (url.searchParams.get("subject") ?? "").trim();
    const db = await getDb();
    const where = subject ? and(eq(examQuestions.status, "published"), eq(examQuestions.examType, examType), eq(examQuestions.subject, subject)) : and(eq(examQuestions.status, "published"), eq(examQuestions.examType, examType));
    const [question] = await db.select().from(examQuestions).where(where).orderBy(sql`random()`).limit(1);
    if (!question) return Response.json({ question: null, message: examType === "mcq" ? "一試真題庫尚未匯入可用題目" : "二試申論真題庫尚未匯入可用題目" });
    let options: Record<string, string> | null = null;
    try { options = question.optionsJson ? JSON.parse(question.optionsJson) as Record<string, string> : null; } catch { options = null; }
    return Response.json({ question: { id: question.id, examType: question.examType, year: question.year, subject: question.subject, questionNumber: question.questionNumber, stem: question.stem, options, hasTeacherAnswer: Boolean(question.teacherAnswer?.trim()), answerSource: question.answerSource, answerStatus: question.answerStatus } });
  } catch { return Response.json({ error: "真題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; answer?: string };
    const questionId = Number(body.questionId); const answer = String(body.answer ?? "").toUpperCase();
    if (!Number.isInteger(questionId) || !/^[ABCD]$/.test(answer)) return Response.json({ error: "作答資料不正確" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"))).limit(1);
    if (!question || question.examType !== "mcq" || !question.correctAnswer) return Response.json({ error: "找不到可作答的選擇題" }, { status: 404 });
    const correctAnswer = question.correctAnswer.toUpperCase(); const correct = answer === correctAnswer;
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId, selectedAnswer: answer, correct });
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: date, subject: question.subject, title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "一試練題", correct, weakness: correct ? "" : "本題觀念或選項判斷待補強", nextStep: correct ? "說明其他選項錯誤理由" : "回顧判斷關鍵並重做本題" });
    return Response.json({ correct, correctAnswer, guidance: correct ? "答對了。先別急著看完整解析：你能說說其他三個選項各錯在哪裡嗎？" : `這題正確答案是 ${correctAnswer}。先不公布完整解析：你當時選 ${answer} 的判斷關鍵是什麼？` });
  } catch { return Response.json({ error: "作答暫時無法儲存" }, { status: 500 }); }
}
