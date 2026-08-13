import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examAttempts, examQuestions, studyRecords } from "../../../../db/schema";
import { taipeiDate } from "../../../../lib/taipei-time";

const topics = ["總論與培養", "病毒檢驗", "DNA 病毒", "RNA 病毒", "肝炎病毒", "抗病毒藥物與疫苗"] as const;
function topicOf(text: string) {
  if (/藥物|疫苗|amantadine|oseltamivir|acyclovir|ganciclovir|干擾素/i.test(text)) return topics[5];
  if (/肝炎|HBV|HCV|HAV|HDV|HEV|HBs|HBe/i.test(text)) return topics[4];
  if (/PCR|檢測|檢驗|培養|抗體|抗原|螢光|ELISA|檢體|細胞株/i.test(text)) return topics[1];
  if (/herpes|疱疹|腺病毒|乳突|parvovirus|pox|polyoma|DNA病毒|DNA 病毒/i.test(text)) return topics[2];
  if (/流感|冠狀|腸病毒|輪狀|登革|HIV|RNA病毒|RNA 病毒|Ebola|狂犬/i.test(text)) return topics[3];
  return topics[0];
}
function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const topic = url.searchParams.get("topic") || "";
  const wrongOnly = url.searchParams.get("wrongOnly") === "1";
  const db = await getDb();
  let wrongIds: number[] = [];
  if (wrongOnly) {
    const attempts = await db.select({ questionId: examAttempts.questionId, correct: examAttempts.correct }).from(examAttempts).where(eq(examAttempts.userKey, userKey(request))).orderBy(desc(examAttempts.id));
    const latest = new Map<number, boolean | null>();
    for (const attempt of attempts) if (!latest.has(attempt.questionId)) latest.set(attempt.questionId, attempt.correct);
    wrongIds = [...latest].filter(([, correct]) => correct === false).map(([id]) => id);
    if (!wrongIds.length) return Response.json({ items: [], message: "目前沒有待複習的錯題。" });
  }
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
    ...(wrongOnly ? [inArray(examQuestions.id, wrongIds)] : []),
  ));

  const cleanStem = (stem: string) => stem.replace(/（(\d{2,3}[.．](?:1|2|7)月專技)）\s*（\1）\s*$/u, "（$1）");
  const mapped = rows.map((row) => ({
      id: row.id,
      year: row.year,
      questionNumber: row.questionNumber,
      stem: cleanStem(row.stem),
      options: JSON.parse(row.optionsJson || "{}") as Record<string, string>,
      answer: row.correctAnswer,
      explanation: row.explanation,
      answerSource: row.answerSource,
      subject: row.subject,
      topic: topicOf(`${row.stem} ${row.explanation}`),
    })).filter((row) => !topic || row.topic === topic).sort(() => Math.random() - .5).slice(0, limit);
  return Response.json({ items: mapped, topics: topics.map((name) => ({ name, count: rows.filter((row) => topicOf(`${row.stem} ${row.explanation}`) === name).length })) });
}

export async function POST(request: Request) {
  const body = await request.json() as { answers?: Array<{ questionId: number; answer: string }> };
  const answers = (body.answers ?? []).filter((item) => Number.isInteger(item.questionId) && /^[A-D]$/.test(item.answer));
  if (!answers.length) return Response.json({ saved: 0 });
  const db = await getDb();
  const questions = await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, answers.map((item) => item.questionId))));
  let saved = 0;
  for (const item of answers) {
    const question = questions.find((row) => row.id === item.questionId);
    if (!question?.correctAnswer) continue;
    const correct = item.answer === question.correctAnswer;
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId: item.questionId, selectedAnswer: item.answer, correct });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId: item.questionId, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師練題", correct, weakness: correct ? "" : topicOf(`${question.stem} ${question.explanation}`), nextStep: correct ? "已掌握" : "加入錯題複習" });
    saved += 1;
  }
  return Response.json({ saved });
}
