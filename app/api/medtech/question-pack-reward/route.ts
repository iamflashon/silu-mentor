import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { examQuestions, medtechPracticeSessions } from "../../../../db/schema";
import { requireMedtechDevice } from "../../../../lib/member-auth";
import { createMedtechPackDiscountReward, createMedtechPackQuizReward, createMedtechUltimateChallengeReward, getMedtechPackDiscountReward, MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT, MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS } from "../../../../lib/medtech-usage";
import { taipeiDate } from "../../../../lib/taipei-time";

const allowedPackages = new Set(["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題", "隨機模考"]);

function readPackage(input: unknown) {
  const value = typeof input === "string" ? input.trim() : "";
  return allowedPackages.has(value) ? value : "隨機模考";
}

function readPackNumber(input: unknown) {
  const value = Math.floor(Number(input));
  return Number.isFinite(value) ? Math.max(1, Math.min(99, value)) : 1;
}

const QUIZ_SIZE = 10;
const ULTIMATE_SESSION_NAME = "醫檢師1折終極挑戰";

function parseQuestionIds(value: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function parseOptions(value: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, text]) => [key, String(text ?? "")])) as Record<string, string>;
  } catch {
    return {};
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function dayBounds() {
  const start = new Date(`${taipeiDate()}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function ultimateOptionMap(options: Record<string, string>) {
  const sourceLetters = ["A", "B", "C", "D"].filter((letter) => options[letter]);
  const shuffled = shuffle(sourceLetters);
  return Object.fromEntries(shuffled.map((sourceLetter, index) => [String.fromCharCode(65 + index), sourceLetter]));
}

function ultimatePayload(value: string) {
  const parsed = parseJsonObject(value);
  const maps = parsed.optionMaps && typeof parsed.optionMaps === "object" && !Array.isArray(parsed.optionMaps) ? parsed.optionMaps as Record<string, unknown> : {};
  return {
    targetPackageName: String(parsed.targetPackageName || ""),
    targetPackNumber: Math.max(1, Math.floor(Number(parsed.targetPackNumber) || 1)),
    optionMaps: maps,
  };
}

function completedSession(row: { completedAt: Date | null; status: string; answeredQuestions?: number; totalQuestions?: number }) {
  return Boolean(row.completedAt || row.status === "completed" || (
    (row.status === "awaiting_submit" || row.status === "in_progress") &&
    Number(row.totalQuestions) > 0 && Number(row.answeredQuestions) >= Number(row.totalQuestions)
  ));
}

async function challengeQuestions(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }, packageName: string, packageNumber: number, requestedIds?: number[]) {
  const sourcePack = packageNumber > 1 ? packageNumber - 1 : packageNumber;
  const sessions = await auth.db.select({ questionIdsJson: medtechPracticeSessions.questionIdsJson, completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions, totalQuestions: medtechPracticeSessions.totalQuestions })
    .from(medtechPracticeSessions)
    .where(and(
      eq(medtechPracticeSessions.userKey, auth.userKey),
      eq(medtechPracticeSessions.packageName, packageName),
      eq(medtechPracticeSessions.packNumber, sourcePack),
    ))
    .orderBy(desc(medtechPracticeSessions.startedAt));
  const session = sessions.find(completedSession);
  const availableIds = session ? parseQuestionIds(session.questionIdsJson) : [];
  const allowedIds = new Set(availableIds);
  const requested = requestedIds?.filter((id) => allowedIds.has(id)).slice(0, QUIZ_SIZE) ?? [];
  const ids = requested.length === QUIZ_SIZE ? requested : shuffle(availableIds).slice(0, QUIZ_SIZE);
  if (!ids.length) return [];
  const rows = await auth.db.select({ id: examQuestions.id, stem: examQuestions.stem, optionsJson: examQuestions.optionsJson })
    .from(examQuestions)
    .where(inArray(examQuestions.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is (typeof rows)[number] => Boolean(row)).map((row) => ({ id: row.id, stem: row.stem, options: parseOptions(row.optionsJson) }));
}

function canUseChallenge(reward: { status: string; percent?: number | null; quizAttemptsUsed?: number; quizAttemptsRemaining?: number }) {
  const remaining = reward.quizAttemptsRemaining ?? 2;
  return remaining > 0 && (reward.status === "available" || reward.percent === 100 || (reward.status === "revealed" && (reward.quizAttemptsUsed ?? 0) > 0));
}

async function canSpinForPackage(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }, packageName: string, packageNumber: number) {
  const isCompleted = (row: { completedAt: Date | null; status: string; answeredQuestions?: number; totalQuestions?: number }) => completedSession(row);
  if (packageNumber > 1) {
    const previousRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions, totalQuestions: medtechPracticeSessions.totalQuestions })
      .from(medtechPracticeSessions)
      .where(and(
        eq(medtechPracticeSessions.userKey, auth.userKey),
        eq(medtechPracticeSessions.packageName, packageName),
        eq(medtechPracticeSessions.packNumber, packageNumber - 1),
      ));
    if (!previousRows.some(isCompleted)) return false;
  }
  const completedRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions, totalQuestions: medtechPracticeSessions.totalQuestions })
    .from(medtechPracticeSessions)
    .where(and(
      eq(medtechPracticeSessions.userKey, auth.userKey),
      eq(medtechPracticeSessions.packageName, packageName),
      eq(medtechPracticeSessions.packNumber, packageNumber),
    ));
  return packageNumber > 1 || completedRows.some(isCompleted);
}

async function findDailyUltimateSession(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }) {
  const { start, end } = dayBounds();
  const [session] = await auth.db.select().from(medtechPracticeSessions).where(and(
    eq(medtechPracticeSessions.userKey, auth.userKey),
    eq(medtechPracticeSessions.packageName, ULTIMATE_SESSION_NAME),
    eq(medtechPracticeSessions.packageType, "ultimate_challenge"),
    gte(medtechPracticeSessions.startedAt, start),
    lt(medtechPracticeSessions.startedAt, end),
  )).orderBy(desc(medtechPracticeSessions.startedAt)).limit(1);
  return session ?? null;
}

async function ultimateQuestionIds(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }, packageName: string, packageNumber: number) {
  const sourcePack = packageNumber > 1 ? packageNumber - 1 : packageNumber;
  const sessions = await auth.db.select({ questionIdsJson: medtechPracticeSessions.questionIdsJson, completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions, totalQuestions: medtechPracticeSessions.totalQuestions })
    .from(medtechPracticeSessions)
    .where(and(
      eq(medtechPracticeSessions.userKey, auth.userKey),
      eq(medtechPracticeSessions.packageName, packageName),
      eq(medtechPracticeSessions.packNumber, sourcePack),
    ))
    .orderBy(desc(medtechPracticeSessions.startedAt));
  const prior = sessions.find(completedSession);
  let ids = prior ? parseQuestionIds(prior.questionIdsJson) : [];
  if (ids.length < MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT) {
    const published = await auth.db.select({ id: examQuestions.id }).from(examQuestions).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.examType, "mcq"),
      eq(examQuestions.status, "published"),
    ));
    ids = shuffle([...new Set([...ids, ...published.map((row) => row.id)])]).slice(0, MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT);
  } else {
    ids = shuffle([...new Set(ids)]).slice(0, MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT);
  }
  return ids;
}

async function ultimateQuestions(
  auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string },
  session: typeof medtechPracticeSessions.$inferSelect,
) {
  const ids = parseQuestionIds(session.questionIdsJson);
  const rows = ids.length ? await auth.db.select({ id: examQuestions.id, stem: examQuestions.stem, optionsJson: examQuestions.optionsJson })
    .from(examQuestions).where(inArray(examQuestions.id, ids)) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const payload = ultimatePayload(session.answerDetailsJson);
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) return null;
    const originalOptions = parseOptions(row.optionsJson);
    const savedMap = payload.optionMaps[String(id)];
    const optionMap = savedMap && typeof savedMap === "object" && !Array.isArray(savedMap)
      ? Object.fromEntries(Object.entries(savedMap).map(([key, value]) => [key, String(value)]))
      : ultimateOptionMap(originalOptions);
    const presentedOptions = Object.fromEntries(["A", "B", "C", "D"].map((letter) => [letter, originalOptions[optionMap[letter]] || ""]));
    return { id: row.id, stem: row.stem, options: presentedOptions };
  }).filter((row): row is { id: number; stem: string; options: Record<string, string> } => Boolean(row));
}

function ultimateResult(session: typeof medtechPracticeSessions.$inferSelect) {
  const payload = parseJsonObject(session.answerDetailsJson);
  return {
    score: Math.max(0, session.correctQuestions || 0),
    total: session.totalQuestions || MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT,
    durationSeconds: session.durationSeconds || 0,
    passed: session.status === "completed" && (session.correctQuestions || 0) === (session.totalQuestions || MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT),
    targetPackageName: String(payload.targetPackageName || ""),
    targetPackNumber: Math.max(1, Math.floor(Number(payload.targetPackNumber) || session.packNumber || 1)),
  };
}

export async function GET(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const packageName = readPackage(url.searchParams.get("packageName"));
  const packageNumber = readPackNumber(url.searchParams.get("pack"));
  if (url.searchParams.get("challenge") === "ultimate") {
    const currentReward = await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
    const dailySession = await findDailyUltimateSession(auth);
    if (dailySession) {
      return Response.json({
        packageName,
        packageNumber,
        challenge: "ultimate",
        status: dailySession.status,
        startedAt: dailySession.startedAt.toISOString(),
        lastActiveAt: dailySession.lastActiveAt.toISOString(),
        currentIndex: Math.max(0, dailySession.lastQuestionIndex || 0),
        timeLimitSeconds: MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS,
        result: dailySession.status === "in_progress" ? null : ultimateResult(dailySession),
        reward: currentReward,
        questions: dailySession.status === "in_progress" ? await ultimateQuestions(auth, dailySession) : [],
      });
    }
    if (currentReward.status !== "available") return Response.json({ error: "這一關已經有折扣結果，請先使用目前折扣解鎖。" }, { status: 409 });
    if (!(await canSpinForPackage(auth, packageName, packageNumber))) return Response.json({ error: "完成上一關後，才可開始 1 折終極挑戰。" }, { status: 403 });
    const ids = await ultimateQuestionIds(auth, packageName, packageNumber);
    if (ids.length < MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT) return Response.json({ error: "目前可用題目不足 30 題，請稍後再試。" }, { status: 409 });
    const rows = await auth.db.select({ id: examQuestions.id, optionsJson: examQuestions.optionsJson }).from(examQuestions).where(inArray(examQuestions.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const optionMaps = Object.fromEntries(ids.map((id) => [String(id), ultimateOptionMap(parseOptions(byId.get(id)?.optionsJson || "{}"))]));
    const session = (await auth.db.insert(medtechPracticeSessions).values({
      userKey: auth.userKey,
      packageName: ULTIMATE_SESSION_NAME,
      packageType: "ultimate_challenge",
      packNumber: packageNumber,
      questionIdsJson: JSON.stringify(ids),
      answerDetailsJson: JSON.stringify({ targetPackageName: packageName, targetPackNumber: packageNumber, optionMaps }),
      startedAt: new Date(),
      lastActiveAt: new Date(),
      totalQuestions: MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT,
      status: "in_progress",
    }).returning())[0];
    if (!session) return Response.json({ error: "終極挑戰建立失敗，請稍後再試。" }, { status: 500 });
    return Response.json({ packageName, packageNumber, challenge: "ultimate", status: "in_progress", startedAt: session.startedAt.toISOString(), lastActiveAt: session.lastActiveAt.toISOString(), currentIndex: 0, timeLimitSeconds: MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, reward: currentReward, questions: await ultimateQuestions(auth, session) });
  }
  if (url.searchParams.get("challenge") === "1") {
    if (!(await canSpinForPackage(auth, packageName, packageNumber))) return Response.json({ error: "完成上一關後，才可開始答題挑戰。" }, { status: 403 });
    const reward = await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
    if (!canUseChallenge(reward)) return Response.json({ error: "這個題目包的答題挑戰次數已用完，請使用目前折扣解鎖。" }, { status: 403 });
    return Response.json({ packageName, packageNumber, attemptsUsed: reward.quizAttemptsUsed ?? 0, attemptsRemaining: reward.quizAttemptsRemaining ?? 2, questions: await challengeQuestions(auth, packageName, packageNumber) });
  }
  const reward = await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
  return Response.json({ packageName, packageNumber, reward });
}

export async function POST(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  let body: { packageName?: unknown; pack?: unknown; action?: unknown; sessionId?: unknown; questionId?: unknown; answer?: unknown; reason?: unknown; answers?: unknown; questionIds?: unknown; timings?: unknown } = {};
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "轉轉樂資料格式錯誤。" }, { status: 400 });
  }
  const packageName = readPackage(body.packageName);
  const packageNumber = readPackNumber(body.pack);
  if (body.action === "ultimate-answer" || body.action === "ultimate-abandon") {
    const dailySession = await findDailyUltimateSession(auth);
    if (!dailySession || dailySession.status !== "in_progress") return Response.json({ error: "今天的 1 折終極挑戰已使用或已結束。" }, { status: 409 });
    const payload = parseJsonObject(dailySession.answerDetailsJson);
    const targetPackageName = String(payload.targetPackageName || "");
    const targetPackNumber = Math.max(1, Math.floor(Number(payload.targetPackNumber) || dailySession.packNumber || 1));
    if (targetPackageName !== packageName || targetPackNumber !== packageNumber) return Response.json({ error: "這次挑戰的題目包已變更，請回到原本的題目包完成。" }, { status: 409 });
    const questionIds = parseQuestionIds(dailySession.questionIdsJson);
    const currentIndex = Math.max(0, Math.min(questionIds.length - 1, Math.floor(dailySession.lastQuestionIndex || 0)));
    const questionId = Number(body.questionId);
    const isAbandon = body.action === "ultimate-abandon";
    if (!isAbandon && (!Number.isInteger(questionId) || questionId !== questionIds[currentIndex])) {
      return Response.json({ error: "題目順序已變更，請重新整理後繼續。" }, { status: 409 });
    }
    const now = new Date();
    const totalElapsedSeconds = Math.max(0, Math.ceil((now.getTime() - dailySession.startedAt.getTime()) / 1000));
    const questionElapsedSeconds = Math.max(0, (now.getTime() - dailySession.lastActiveAt.getTime()) / 1000);
    const answer = typeof body.answer === "string" && /^[A-D]$/.test(body.answer) ? body.answer : null;
    const rows = questionIds.length ? await auth.db.select({ id: examQuestions.id, correctAnswer: examQuestions.correctAnswer, teacherAnswer: examQuestions.teacherAnswer, simulatedAnswer: examQuestions.simulatedAnswer }).from(examQuestions).where(inArray(examQuestions.id, questionIds)) : [];
    const correctById = new Map(rows.map((row) => [row.id, row.teacherAnswer || row.correctAnswer || row.simulatedAnswer || ""]));
    const optionMaps = payload.optionMaps && typeof payload.optionMaps === "object" && !Array.isArray(payload.optionMaps) ? payload.optionMaps as Record<string, unknown> : {};
    const optionMap = optionMaps[String(questionId)];
    const originalAnswer = optionMap && typeof optionMap === "object" && !Array.isArray(optionMap)
      ? String((optionMap as Record<string, unknown>)[answer || ""] || "")
      : answer || "";
    const timedOut = totalElapsedSeconds > MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS || questionElapsedSeconds > 5;
    const correct = !isAbandon && !timedOut && Boolean(answer) && originalAnswer === correctById.get(questionId);
    const previousAnswers = Array.isArray(payload.answers) ? payload.answers.filter((item): item is { questionId: number; order: number; answer: string | null; correct: boolean } => Boolean(item && typeof item === "object" && Number.isInteger((item as { questionId?: unknown }).questionId))).filter((item, index, items) => items.findIndex((candidate) => candidate.questionId === item.questionId) === index) : [];
    const currentAnswer = !isAbandon && Number.isInteger(questionId) ? { questionId, order: currentIndex, answer, correct } : null;
    const answerDetails = currentAnswer ? [...previousAnswers.filter((item) => item.questionId !== questionId), currentAnswer].sort((left, right) => left.order - right.order) : previousAnswers;
    const nextPayload = { ...payload, answers: answerDetails, endedBy: correct ? undefined : (isAbandon ? "abandoned" : timedOut ? "time_limit" : "wrong_answer") };
    const answeredQuestions = answerDetails.filter((item) => Boolean(item.answer)).length;
    const correctQuestions = answerDetails.filter((item) => item.correct).length;
    if (!correct) {
      await auth.db.update(medtechPracticeSessions).set({
        status: "failed",
        completedAt: now,
        lastActiveAt: now,
        durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, totalElapsedSeconds),
        answeredQuestions,
        correctQuestions,
        incorrectQuestionIdsJson: JSON.stringify(answerDetails.filter((item) => !item.correct).map((item) => item.questionId)),
        answerDetailsJson: JSON.stringify(nextPayload),
      }).where(eq(medtechPracticeSessions.id, dailySession.id));
      return Response.json({ packageName, packageNumber, challenge: "ultimate", status: "failed", correct: false, score: correctQuestions, total: questionIds.length, durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, totalElapsedSeconds), passed: false, reason: nextPayload.endedBy });
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex >= questionIds.length) {
      await auth.db.update(medtechPracticeSessions).set({
        status: "completed",
        completedAt: now,
        lastActiveAt: now,
        lastQuestionIndex: nextIndex,
        durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, totalElapsedSeconds),
        answeredQuestions,
        correctQuestions,
        answerDetailsJson: JSON.stringify({ ...nextPayload, endedBy: "completed" }),
      }).where(eq(medtechPracticeSessions.id, dailySession.id));
      const reward = await createMedtechUltimateChallengeReward(auth.db, auth.userKey, packageName, packageNumber, correctQuestions, questionIds.length, totalElapsedSeconds);
      return Response.json({ packageName, packageNumber, challenge: "ultimate", status: "completed", correct: true, score: correctQuestions, total: questionIds.length, durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, totalElapsedSeconds), passed: true, reward });
    }
    await auth.db.update(medtechPracticeSessions).set({
      status: "in_progress",
      lastActiveAt: now,
      lastQuestionIndex: nextIndex,
      answeredQuestions,
      correctQuestions,
      answerDetailsJson: JSON.stringify(nextPayload),
    }).where(eq(medtechPracticeSessions.id, dailySession.id));
    return Response.json({ packageName, packageNumber, challenge: "ultimate", status: "in_progress", correct: true, nextIndex, score: correctQuestions, total: questionIds.length, durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, totalElapsedSeconds), passed: false });
  }
  if (body.action === "ultimate") {
    const dailySession = await findDailyUltimateSession(auth);
    if (!dailySession || dailySession.status !== "in_progress") return Response.json({ error: "今天的 1 折終極挑戰已使用或已結束。" }, { status: 409 });
    const payload = ultimatePayload(dailySession.answerDetailsJson);
    if (payload.targetPackageName !== packageName || payload.targetPackNumber !== packageNumber) return Response.json({ error: "這次挑戰的題目包已變更，請回到原本的題目包完成。" }, { status: 409 });
    const elapsedSeconds = Math.max(0, Math.ceil((Date.now() - dailySession.startedAt.getTime()) / 1000));
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const answerMap = new Map(answers.filter((item): item is { questionId: number; answer: string } => Boolean(item && typeof item === "object" && Number.isInteger((item as { questionId?: unknown }).questionId) && /^[A-D]$/.test(String((item as { answer?: unknown }).answer ?? "")))).map((item) => [item.questionId, item.answer]));
    const questionIds = parseQuestionIds(dailySession.questionIdsJson);
    const rows = questionIds.length ? await auth.db.select({ id: examQuestions.id, correctAnswer: examQuestions.correctAnswer, teacherAnswer: examQuestions.teacherAnswer, simulatedAnswer: examQuestions.simulatedAnswer }).from(examQuestions).where(inArray(examQuestions.id, questionIds)) : [];
    const correctById = new Map(rows.map((row) => [row.id, row.teacherAnswer || row.correctAnswer || row.simulatedAnswer || ""]));
    const score = questionIds.reduce((total, id) => {
      const presentedAnswer = answerMap.get(id);
      const optionMap = payload.optionMaps[String(id)];
      const originalAnswer = optionMap && typeof optionMap === "object" && !Array.isArray(optionMap) ? String((optionMap as Record<string, unknown>)[presentedAnswer || ""] || "") : presentedAnswer;
      return total + (originalAnswer && originalAnswer === correctById.get(id) ? 1 : 0);
    }, 0);
    const passed = elapsedSeconds <= MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS && questionIds.length === MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT && answerMap.size === questionIds.length && score === questionIds.length;
    const finalPayload = { ...payload, answers: questionIds.map((id, order) => ({ questionId: id, order, answer: answerMap.get(id) || null, correct: Boolean(answerMap.get(id) && (() => { const map = payload.optionMaps[String(id)]; const original = map && typeof map === "object" && !Array.isArray(map) ? String((map as Record<string, unknown>)[answerMap.get(id) || ""] || "") : answerMap.get(id) || ""; return original === correctById.get(id); })()) })) };
    await auth.db.update(medtechPracticeSessions).set({
      status: passed ? "completed" : "failed",
      completedAt: new Date(),
      lastActiveAt: new Date(),
      durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, elapsedSeconds),
      answeredQuestions: answerMap.size,
      correctQuestions: score,
      answerDetailsJson: JSON.stringify(finalPayload),
    }).where(eq(medtechPracticeSessions.id, dailySession.id));
    const reward = passed ? await createMedtechUltimateChallengeReward(auth.db, auth.userKey, packageName, packageNumber, score, questionIds.length, elapsedSeconds) : await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
    return Response.json({ packageName, packageNumber, challenge: "ultimate", status: passed ? "completed" : "failed", score, total: questionIds.length, durationSeconds: Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, elapsedSeconds), passed, reward });
  }
  const action = body.action === "abandon" ? "abandon" : body.action === "spin" ? "spin" : "";
  if (body.action === "quiz") {
    if (!(await canSpinForPackage(auth, packageName, packageNumber))) return Response.json({ error: "完成上一關後，才可開始答題挑戰。" }, { status: 403 });
    const currentReward = await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
    if (!canUseChallenge(currentReward)) return Response.json({ error: "這個題目包的答題挑戰次數已用完，請使用目前折扣解鎖。" }, { status: 403 });
    const requestedIds = Array.isArray(body.questionIds) ? body.questionIds.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
    const questions = await challengeQuestions(auth, packageName, packageNumber, requestedIds);
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const answerMap = new Map(answers.filter((item): item is { questionId: number; answer: string } => Boolean(item && typeof item === "object" && Number.isInteger((item as { questionId?: unknown }).questionId) && /^[A-D]$/.test(String((item as { answer?: unknown }).answer ?? "")))).map((item) => [item.questionId, item.answer]));
    const timings = Array.isArray(body.timings) ? body.timings : [];
    const timingMap = new Map(timings.filter((item): item is { questionId: number; seconds: number } => Boolean(item && typeof item === "object" && Number.isInteger((item as { questionId?: unknown }).questionId) && Number.isFinite(Number((item as { seconds?: unknown }).seconds)))).map((item) => [item.questionId, Number(item.seconds)]));
    const ids = questions.map((question) => question.id);
    if (!ids.length) return Response.json({ error: "目前沒有可用的前一關題目，請先完成上一關並重新整理。" }, { status: 409 });
    const rows = await auth.db.select({ id: examQuestions.id, correctAnswer: examQuestions.correctAnswer, teacherAnswer: examQuestions.teacherAnswer, simulatedAnswer: examQuestions.simulatedAnswer })
      .from(examQuestions)
      .where(inArray(examQuestions.id, ids));
    const correctById = new Map(rows.map((row) => [row.id, row.teacherAnswer || row.correctAnswer || row.simulatedAnswer || ""]));
    const score = ids.reduce((total, id) => total + (answerMap.get(id) === correctById.get(id) ? 1 : 0), 0);
    const averageSeconds = ids.length ? ids.reduce((total, id) => total + Math.max(0, Math.min(5, timingMap.get(id) ?? 5)), 0) / ids.length : 5;
    const reward = await createMedtechPackQuizReward(auth.db, auth.userKey, packageName, packageNumber, score, ids.length, averageSeconds);
    return Response.json({ packageName, packageNumber, score, total: ids.length, averageSeconds: Number(averageSeconds.toFixed(1)), attemptsUsed: reward.quizAttemptsUsed ?? 0, attemptsRemaining: reward.quizAttemptsRemaining ?? 0, reward });
  }
  if (!action) return Response.json({ error: "請選擇抽取折扣或放棄優惠。" }, { status: 400 });
  if (!(await canSpinForPackage(auth, packageName, packageNumber))) {
    return Response.json({ error: "完成上一關後，才可抽取這一關的折扣。" }, { status: 403 });
  }
  const reward = await createMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber, action);
  return Response.json({ packageName, packageNumber, reward });
}
