import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examAttempts, examQuestions, listeningSolutions, listeningSubtitleCues, studyRecords } from "../../../../db/schema";
import { taipeiDate } from "../../../../lib/taipei-time";

const topics = ["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題"] as const;
function topicOf(sourceName = "", subject = ""): (typeof topics)[number] | null {
  const source = `${sourceName} ${subject}`;
  if (/全真模擬|模擬試題/i.test(source)) return topics[3];
  if (/DNA\s*病毒/i.test(source)) return topics[1];
  if (/RNA\s*病毒/i.test(source)) return topics[2];
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source)) return topics[0];
  return null;
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
  const sourceDocuments = await db.select({ id: documents.id, fileName: documents.fileName, subject: documents.subject }).from(documents).where(eq(documents.examCategory, "medtech"));
  const sourceById = new Map(sourceDocuments.map(document => [document.id, document]));
  const rows = await db.select({
    id: examQuestions.id,
    year: examQuestions.year,
    questionNumber: examQuestions.questionNumber,
    stem: examQuestions.stem,
    optionsJson: examQuestions.optionsJson,
    correctAnswer: examQuestions.correctAnswer,
    teacherAnswer: examQuestions.teacherAnswer,
    simulatedAnswer: examQuestions.simulatedAnswer,
    teacherCompleteExplanation: examQuestions.teacherCompleteExplanation,
    aiCompleteExplanation: examQuestions.aiCompleteExplanation,
    simulatedCompleteExplanation: examQuestions.simulatedCompleteExplanation,
    completeExplanation: examQuestions.completeExplanation,
    explanation: examQuestions.explanation,
    answerSource: examQuestions.answerSource,
    subject: examQuestions.subject,
    sourceUrl: examQuestions.sourceUrl,
  }).from(examQuestions).where(and(
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
    eq(examQuestions.status, "published"),
    ...(wrongOnly ? [inArray(examQuestions.id, wrongIds)] : []),
  ));

  const questionIds = rows.map((row) => row.id);
  const mediaRows = questionIds.length
    ? await db.select({ id: listeningSolutions.id, questionId: listeningSolutions.questionId, audioStorageKey: listeningSolutions.audioStorageKey }).from(listeningSolutions).where(inArray(listeningSolutions.questionId, questionIds))
    : [];
  const mediaIds = mediaRows.map((row) => row.id);
  const cueRows = mediaIds.length
    ? await db.select({ id: listeningSubtitleCues.id, listeningId: listeningSubtitleCues.listeningId, startSeconds: listeningSubtitleCues.startSeconds, endSeconds: listeningSubtitleCues.endSeconds, text: listeningSubtitleCues.text, sequence: listeningSubtitleCues.sequence }).from(listeningSubtitleCues).where(inArray(listeningSubtitleCues.listeningId, mediaIds))
    : [];
  const mediaByQuestion = new Map<number, { id: number; audioStorageKey: string | null; cues: typeof cueRows }>();
  for (const media of mediaRows) if (media.questionId) mediaByQuestion.set(media.questionId, { id: media.id, audioStorageKey: media.audioStorageKey, cues: cueRows.filter((cue) => cue.listeningId === media.id).sort((left, right) => left.sequence - right.sequence) });

  const cleanStem = (stem: string) => stem.replace(/（(\d{2,3}[.．](?:1|2|7)月專技)）\s*（\1）\s*$/u, "（$1）");
  const mapped = rows.map((row) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceById.get(sourceId);
    const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
    return {
      id: row.id,
      year: row.year,
      questionNumber: row.questionNumber,
      stem: cleanStem(row.stem),
      options: JSON.parse(row.optionsJson || "{}") as Record<string, string>,
      answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
      answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
      explanation: row.teacherCompleteExplanation || row.completeExplanation || row.aiCompleteExplanation || row.simulatedCompleteExplanation || row.explanation,
      explanationLabel: row.teacherCompleteExplanation || row.completeExplanation ? "完整解析" : row.aiCompleteExplanation || row.simulatedCompleteExplanation ? "AI 完整解析（此為 AI 版本）" : "解析",
      answerSource: row.answerSource,
      subject: row.subject,
      topic,
      audioUrl: mediaByQuestion.get(row.id)?.audioStorageKey ? `/api/listening/audio?id=${mediaByQuestion.get(row.id)!.id}` : "",
      subtitles: (mediaByQuestion.get(row.id)?.cues ?? []).map((cue) => ({ id: cue.id, segmentId: null, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text, sequence: cue.sequence })),
    };
  }).filter((row) => !topic || row.topic === topic).sort(() => Math.random() - .5).slice(0, limit);
  return Response.json({ items: mapped, topics: topics.map((name) => ({ name, count: rows.filter((row) => { const sourceId = Number(row.sourceUrl.replace(/^document:/, "")); const source = sourceById.get(sourceId); return topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === name; }).length })) });
}

export async function POST(request: Request) {
  const body = await request.json() as { answers?: Array<{ questionId: number; answer: string }>; masteredQuestionId?: number };
  if (Number.isInteger(body.masteredQuestionId)) {
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, Number(body.masteredQuestionId)), eq(examQuestions.examCategory, "medtech"))).limit(1);
    if (!question) return Response.json({ error: "找不到醫檢師題目" }, { status: 404 });
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId: question.id, selectedAnswer: null, correct: true, gradingJson: JSON.stringify({ action: "mastered" }) });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId: question.id, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師錯題複習", correct: true, weakness: "", nextStep: "已手動標記學會" });
    return Response.json({ mastered: true, questionId: question.id });
  }
  const answers = (body.answers ?? []).filter((item) => Number.isInteger(item.questionId) && /^[A-D]$/.test(item.answer));
  if (!answers.length) return Response.json({ saved: 0 });
  const db = await getDb();
  const questions = await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, answers.map((item) => item.questionId))));
  let saved = 0;
  for (const item of answers) {
    const question = questions.find((row) => row.id === item.questionId);
    if (!question) continue;
    const activeAnswer = question.teacherAnswer || question.correctAnswer || question.simulatedAnswer || "";
    if (!activeAnswer) continue;
    const correct = item.answer === activeAnswer;
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId: item.questionId, selectedAnswer: item.answer, correct });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId: item.questionId, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師練題", correct, weakness: correct ? "" : (topicOf("", question.subject) ?? topics[0]), nextStep: correct ? "已掌握" : "加入錯題複習" });
    saved += 1;
  }
  return Response.json({ saved });
}
