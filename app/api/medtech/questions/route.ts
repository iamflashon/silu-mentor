import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions } from "../../../../db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const db = await getDb();
  const rows = await db.select({
    id: examQuestions.id,
    year: examQuestions.year,
    questionNumber: examQuestions.questionNumber,
    stem: examQuestions.stem,
    optionsJson: examQuestions.optionsJson,
    correctAnswer: examQuestions.correctAnswer,
    explanation: examQuestions.explanation,
    answerSource: examQuestions.answerSource,
    subject: examQuestions.subject,
  }).from(examQuestions).where(and(
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
    eq(examQuestions.status, "published"),
  )).orderBy(sql`random()`).limit(limit);

  const cleanStem = (stem: string) => stem.replace(/（(\d{2,3}[.．](?:1|2|7)月專技)）\s*（\1）\s*$/u, "（$1）");
  return Response.json({
    items: rows.map((row) => ({
      id: row.id,
      year: row.year,
      questionNumber: row.questionNumber,
      stem: cleanStem(row.stem),
      options: JSON.parse(row.optionsJson || "{}") as Record<string, string>,
      answer: row.correctAnswer,
      explanation: row.explanation,
      answerSource: row.answerSource,
      subject: row.subject,
    })),
  });
}
