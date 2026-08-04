import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { examCoachMessages, examQuestions } from "../../../db/schema";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const questionId = Number(new URL(request.url).searchParams.get("questionId") || 0);
    const db = await getDb();
    const rows = await db.select({ id: examCoachMessages.id, questionId: examCoachMessages.questionId, role: examCoachMessages.role, text: examCoachMessages.text, createdAt: examCoachMessages.createdAt, year: examQuestions.year, subject: examQuestions.subject, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem })
      .from(examCoachMessages).innerJoin(examQuestions, eq(examCoachMessages.questionId, examQuestions.id))
      .where(questionId > 0 ? and(eq(examCoachMessages.userKey, userKey(request)), eq(examCoachMessages.questionId, questionId)) : eq(examCoachMessages.userKey, userKey(request)))
      .orderBy(desc(examCoachMessages.createdAt), asc(examCoachMessages.id)).limit(300);
    const groups = new Map<number, { questionId: number; year: string; subject: string; questionNumber: string; stem: string; messages: typeof rows }>();
    for (const row of rows) {
      const current = groups.get(row.questionId) ?? { questionId: row.questionId, year: row.year, subject: row.subject, questionNumber: row.questionNumber, stem: row.stem, messages: [] };
      current.messages.unshift(row);
      groups.set(row.questionId, current);
    }
    return Response.json({ conversations: Array.from(groups.values()) });
  } catch { return Response.json({ error: "試題問答紀錄暫時無法讀取" }, { status: 503 }); }
}
