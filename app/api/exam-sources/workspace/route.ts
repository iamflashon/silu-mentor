import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions, examSourceItems, examSources } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

function missingQuestionNumbers(numbers: string[]) {
  const parsed = numbers
    .map((value) => Number(value.match(/\d+/)?.[0] ?? 0))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (parsed.length < 2) return [];
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let number = unique[0]; number <= unique.at(-1)!; number += 1) {
    if (!unique.includes(number)) missing.push(number);
  }
  return missing.slice(0, 100);
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const sourceId = Number(new URL(request.url).searchParams.get("sourceId"));
  if (!Number.isInteger(sourceId) || sourceId < 1) {
    return Response.json({ error: "來源編號不正確" }, { status: 400 });
  }
  const db = await getDb();
  const [source] = await db.select().from(examSources).where(eq(examSources.id, sourceId)).limit(1);
  if (!source) return Response.json({ error: "找不到題庫來源" }, { status: 404 });
  const items = await db.select().from(examSourceItems).where(eq(examSourceItems.sourceId, sourceId)).orderBy(asc(examSourceItems.year), asc(examSourceItems.id));
  const fileUrls = items.map((item) => item.fileUrl);
  const questions = fileUrls.length
    ? await db.select({
        id: examQuestions.id,
        sourceUrl: examQuestions.sourceUrl,
        examType: examQuestions.examType,
        year: examQuestions.year,
        examName: examQuestions.examName,
        subject: examQuestions.subject,
        questionNumber: examQuestions.questionNumber,
        stem: examQuestions.stem,
        optionsJson: examQuestions.optionsJson,
        correctAnswer: examQuestions.correctAnswer,
        explanation: examQuestions.explanation,
        teacherAnswer: examQuestions.teacherAnswer,
        teacherNotes: examQuestions.teacherNotes,
        rubricJson: examQuestions.rubricJson,
        answerSource: examQuestions.answerSource,
        answerStatus: examQuestions.answerStatus,
        status: examQuestions.status,
        reviewStatus: examQuestions.reviewStatus,
      }).from(examQuestions).where(inArray(examQuestions.sourceUrl, fileUrls)).orderBy(asc(examQuestions.id))
    : [];
  return Response.json({
    source,
    items: items.map((item) => {
      const itemQuestions = questions.filter((question) => question.sourceUrl === item.fileUrl);
      return {
        ...item,
        actualQuestionCount: itemQuestions.length,
        missingQuestionNumbers: missingQuestionNumbers(itemQuestions.map((question) => question.questionNumber)),
      };
    }),
    questions: questions.map((question) => ({
      ...question,
      options: (() => { try { return question.optionsJson ? JSON.parse(question.optionsJson) : {}; } catch { return {}; } })(),
      rubric: (() => { try { return question.rubricJson ? JSON.parse(question.rubricJson) : []; } catch { return []; } })(),
    })),
  });
}
