import { and, desc, eq, inArray } from "drizzle-orm";
import { examQuestions, medtechPracticeSessions } from "../../../../db/schema";
import { requireMedtechDevice } from "../../../../lib/member-auth";
import { createMedtechPackDiscountReward, createMedtechPackQuizReward, getMedtechPackDiscountReward } from "../../../../lib/medtech-usage";

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

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function completedSession(row: { completedAt: Date | null; status: string }) {
  return Boolean(row.completedAt || row.status === "completed");
}

async function challengeQuestions(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }, packageName: string, packageNumber: number, requestedIds?: number[]) {
  const sourcePack = packageNumber > 1 ? packageNumber - 1 : packageNumber;
  const sessions = await auth.db.select({ questionIdsJson: medtechPracticeSessions.questionIdsJson, completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status })
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
  const isCompleted = (row: { completedAt: Date | null; status: string }) => Boolean(row.completedAt || row.status === "completed");
  if (packageNumber > 1) {
    const previousRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status })
      .from(medtechPracticeSessions)
      .where(and(
        eq(medtechPracticeSessions.userKey, auth.userKey),
        eq(medtechPracticeSessions.packageName, packageName),
        eq(medtechPracticeSessions.packNumber, packageNumber - 1),
      ));
    if (!previousRows.some(isCompleted)) return false;
  }
  const completedRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status })
    .from(medtechPracticeSessions)
    .where(and(
      eq(medtechPracticeSessions.userKey, auth.userKey),
      eq(medtechPracticeSessions.packageName, packageName),
      eq(medtechPracticeSessions.packNumber, packageNumber),
    ));
  return packageNumber > 1 || completedRows.some(isCompleted);
}

export async function GET(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const packageName = readPackage(url.searchParams.get("packageName"));
  const packageNumber = readPackNumber(url.searchParams.get("pack"));
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
  let body: { packageName?: unknown; pack?: unknown; action?: unknown; answers?: unknown; questionIds?: unknown; timings?: unknown } = {};
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "轉轉樂資料格式錯誤。" }, { status: 400 });
  }
  const packageName = readPackage(body.packageName);
  const packageNumber = readPackNumber(body.pack);
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
