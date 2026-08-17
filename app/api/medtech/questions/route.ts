import { and, desc, eq, inArray } from "drizzle-orm";
import { documents, examAttempts, examQuestions, listeningSolutions, listeningSubtitleCues, studyRecords } from "../../../../db/schema";
import { requireMedtechMember } from "../../../../lib/member-auth";
import { grantMedtechQuestionAccess, medtechUserKey } from "../../../../lib/medtech-usage";
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
function userKey(request: Request) { return medtechUserKey(request); }

export async function GET(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const topic = url.searchParams.get("topic") || "";
  const wrongOnly = url.searchParams.get("wrongOnly") === "1";
  const practiceOnly = url.searchParams.get("mode") === "practice";
  const reviewOnly = url.searchParams.get("mode") === "review";
  const reviewIds = url.searchParams.get("ids")?.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0).slice(0, 50) ?? [];
  const db = auth.db;
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
    answerSource: examQuestions.answerSource,
    subject: examQuestions.subject,
    sourceUrl: examQuestions.sourceUrl,
  }).from(examQuestions).where(and(
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
    eq(examQuestions.status, "published"),
    ...(wrongOnly ? [inArray(examQuestions.id, wrongIds)] : []),
  ));

  // Filter and sample before loading optional audio/subtitle relations. The
  // published medical-tech bank can contain more than a thousand questions;
  // passing every question id to D1's `IN (...)` query exceeds its bound
  // parameter limit and makes the random-practice endpoint return an empty
  // response.
  const topicRows = rows.filter((row) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceById.get(sourceId);
    return !topic || topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === topic;
  });
  let selectedRows = reviewOnly
    ? topicRows.filter((row) => reviewIds.includes(row.id)).slice(0, limit)
    : topicRows.sort(() => Math.random() - .5).slice(0, limit);
  const access = await grantMedtechQuestionAccess(db, auth.userKey, selectedRows.map((row) => row.id));
  if (selectedRows.length && !access.allowedIds.length) {
    return Response.json({ error: "點數不足；查看一題扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", points: access.usage.aiCredits, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
  }
  const allowedIds = new Set(access.allowedIds);
  selectedRows = selectedRows.filter((row) => allowedIds.has(row.id));
  const questionIds = selectedRows.map((row) => row.id);
  const cleanStem = (stem: string) => stem.replace(/（(\d{2,3}[.．](?:1|2|7)月專技)）\s*（\1）\s*$/u, "（$1）");

  // The exam-taking screen only needs question data. Do not load explanation
  // columns or optional audio/subtitle relations until a feature asks for
  // them; this also keeps a question-only mock exam independent of media.
  if (practiceOnly) {
    const mapped = selectedRows.map((row) => {
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
        answerSource: row.answerSource,
        subject: row.subject,
        topic,
      };
    });
    return Response.json({ items: mapped, points: access.usage.aiCredits, accessLimited: access.limited, topics: topics.map((name) => ({ name, count: rows.filter((row) => {
      const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
      const source = sourceById.get(sourceId);
      return topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === name;
    }).length })) });
  }

  const detailRows = questionIds.length
    ? await db.select({
        id: examQuestions.id,
        teacherCompleteExplanation: examQuestions.teacherCompleteExplanation,
        aiCompleteExplanation: examQuestions.aiCompleteExplanation,
        simulatedCompleteExplanation: examQuestions.simulatedCompleteExplanation,
        completeExplanation: examQuestions.completeExplanation,
        explanation: examQuestions.explanation,
      }).from(examQuestions).where(inArray(examQuestions.id, questionIds))
    : [];
  const detailByQuestion = new Map(detailRows.map((row) => [row.id, row]));
  if (reviewOnly) {
    const mapped = selectedRows.map((row) => {
      const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
      const source = sourceById.get(sourceId);
      const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
      const detail = detailByQuestion.get(row.id);
      const fullExplanation = detail?.teacherCompleteExplanation || detail?.completeExplanation || detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation || "";
      return {
        id: row.id,
        year: row.year,
        questionNumber: row.questionNumber,
        stem: cleanStem(row.stem),
        options: JSON.parse(row.optionsJson || "{}") as Record<string, string>,
        answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
        answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
        explanation: detail?.explanation || "",
        answerSource: row.answerSource,
        subject: row.subject,
        topic,
        hasFullExplanation: Boolean(fullExplanation.trim()),
      };
    });
    return Response.json({ items: mapped, points: access.usage.aiCredits, accessLimited: access.limited });
  }
  const mediaRows = questionIds.length
    ? await db.select({ id: listeningSolutions.id, questionId: listeningSolutions.questionId, audioStorageKey: listeningSolutions.audioStorageKey }).from(listeningSolutions).where(inArray(listeningSolutions.questionId, questionIds))
    : [];
  const mediaIds = mediaRows.map((row) => row.id);
  const cueRows = mediaIds.length
    ? await db.select({ id: listeningSubtitleCues.id, listeningId: listeningSubtitleCues.listeningId, startSeconds: listeningSubtitleCues.startSeconds, endSeconds: listeningSubtitleCues.endSeconds, text: listeningSubtitleCues.text, sequence: listeningSubtitleCues.sequence }).from(listeningSubtitleCues).where(inArray(listeningSubtitleCues.listeningId, mediaIds))
    : [];
  const mediaByQuestion = new Map<number, { id: number; audioStorageKey: string | null; cues: typeof cueRows }>();
  for (const media of mediaRows) if (media.questionId) mediaByQuestion.set(media.questionId, { id: media.id, audioStorageKey: media.audioStorageKey, cues: cueRows.filter((cue) => cue.listeningId === media.id).sort((left, right) => left.sequence - right.sequence) });

  const mapped = selectedRows.map((row) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceById.get(sourceId);
    const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
    const detail = detailByQuestion.get(row.id);
    return {
      id: row.id,
      year: row.year,
      questionNumber: row.questionNumber,
      stem: cleanStem(row.stem),
      options: JSON.parse(row.optionsJson || "{}") as Record<string, string>,
      answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
      answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
      explanation: detail?.teacherCompleteExplanation || detail?.completeExplanation || detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation || detail?.explanation || "",
      explanationLabel: detail?.teacherCompleteExplanation || detail?.completeExplanation ? "完整解析" : detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation ? "AI 完整解析（此為 AI 版本）" : "解析",
      answerSource: row.answerSource,
      subject: row.subject,
      topic,
      audioUrl: mediaByQuestion.get(row.id)?.audioStorageKey ? `/api/listening/audio?id=${mediaByQuestion.get(row.id)!.id}` : "",
      subtitles: (mediaByQuestion.get(row.id)?.cues ?? []).map((cue) => ({ id: cue.id, segmentId: null, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text, sequence: cue.sequence })),
    };
  });
  return Response.json({ items: mapped, points: access.usage.aiCredits, accessLimited: access.limited, topics: topics.map((name) => ({ name, count: rows.filter((row) => { const sourceId = Number(row.sourceUrl.replace(/^document:/, "")); const source = sourceById.get(sourceId); return topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === name; }).length })) });
}

export async function POST(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { answers?: Array<{ questionId: number; answer: string }>; masteredQuestionId?: number };
  if (Number.isInteger(body.masteredQuestionId)) {
    const db = auth.db;
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, Number(body.masteredQuestionId)), eq(examQuestions.examCategory, "medtech"))).limit(1);
    if (!question) return Response.json({ error: "找不到醫檢師題目" }, { status: 404 });
    await db.insert(examAttempts).values({ userKey: auth.userKey, questionId: question.id, selectedAnswer: null, correct: true, gradingJson: JSON.stringify({ action: "mastered" }) });
    await db.insert(studyRecords).values({ userKey: auth.userKey, questionId: question.id, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師錯題複習", correct: true, weakness: "", nextStep: "已手動標記學會" });
    return Response.json({ mastered: true, questionId: question.id });
  }
  const answers = (body.answers ?? []).filter((item) => Number.isInteger(item.questionId) && /^[A-D]$/.test(item.answer));
  if (!answers.length) return Response.json({ saved: 0 });
  const db = auth.db;
  const questions = await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, answers.map((item) => item.questionId))));
  let saved = 0;
  for (const item of answers) {
    const question = questions.find((row) => row.id === item.questionId);
    if (!question) continue;
    const activeAnswer = question.teacherAnswer || question.correctAnswer || question.simulatedAnswer || "";
    if (!activeAnswer) continue;
    const correct = item.answer === activeAnswer;
    await db.insert(examAttempts).values({ userKey: auth.userKey, questionId: item.questionId, selectedAnswer: item.answer, correct });
    await db.insert(studyRecords).values({ userKey: auth.userKey, questionId: item.questionId, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師練題", correct, weakness: correct ? "" : (topicOf("", question.subject) ?? topics[0]), nextStep: correct ? "已掌握" : "加入錯題複習" });
    saved += 1;
  }
  return Response.json({ saved });
}
