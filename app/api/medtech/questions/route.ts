import { and, desc, eq, inArray, isNotNull, isNull, or, gte } from "drizzle-orm";
import { documents, examAttempts, examQuestions, listeningSolutions, listeningSubtitleCues, medtechPracticeSessions, studyRecords } from "../../../../db/schema";
import { requireMedtechDevice } from "../../../../lib/member-auth";
import { getOrCreateMedtechUsage, grantMedtechQuestionAccess, grantMedtechQuestionPackageAccess, MEDTECH_QUESTION_PACKAGE_SIZE } from "../../../../lib/medtech-usage";
import { taipeiDate } from "../../../../lib/taipei-time";
import { storedDocumentAnalysis } from "../../../../lib/document-analysis";

const topics = ["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題"] as const;
function topicOf(sourceName = "", subject = ""): (typeof topics)[number] | null {
  const source = `${sourceName} ${subject}`;
  if (/全真模擬|模擬試題/i.test(source)) return topics[3];
  if (/DNA\s*病毒/i.test(source)) return topics[1];
  if (/RNA\s*病毒/i.test(source)) return topics[2];
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source)) return topics[0];
  return null;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function textField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").replace(/\s+/gu, " ").trim();
    if (value) return value;
  }
  return "";
}

function parseIds(value: string) {
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
    return Object.fromEntries(Object.entries(parsed).map(([letter, text]) => [letter, String(text ?? "")])) as Record<string, string>;
  } catch {
    return {};
  }
}

type PracticeAnswerDetail = {
  questionId: number;
  order: number;
  answer: string | null;
  durationSeconds: number;
  answeredAt: string | null;
  correct?: boolean | null;
};

function parseAnswerDetails(value: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item, index): PracticeAnswerDetail | null => {
      const questionId = Number(item.questionId);
      if (!Number.isInteger(questionId) || questionId < 1) return null;
      const answer = typeof item.answer === "string" && /^[A-D]$/.test(item.answer) ? item.answer : null;
      const durationSeconds = Math.max(0, Math.min(604800, Math.floor(Number(item.durationSeconds) || 0)));
      const correct = typeof item.correct === "boolean" ? item.correct : null;
      return { questionId, order: Math.max(0, Math.floor(Number(item.order) || index)), answer, durationSeconds, answeredAt: typeof item.answeredAt === "string" ? item.answeredAt : null, correct };
    }).filter((item): item is PracticeAnswerDetail => Boolean(item));
  } catch {
    return [];
  }
}

function sameIdSet(left: number[], right: number[]) {
  const normalize = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

function shuffleRows<T extends { id: number }>(rows: T[]) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function orderRowsByIds<T extends { id: number }>(rows: T[], orderedIds: number[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((row): row is T => Boolean(row));
  const included = new Set(ordered.map((row) => row.id));
  return [...ordered, ...rows.filter((row) => !included.has(row.id))];
}

function chapterByOrder(processingResultJson: string) {
  const parsed = storedDocumentAnalysis(processingResultJson || "{}") as Record<string, unknown> & { questions?: unknown[] };
  const facts = parsed.facts && typeof parsed.facts === "object" ? parsed.facts as Record<string, unknown> : {};
  const candidates = [
    recordArray(parsed.questions),
    recordArray(facts.questionCandidates),
    recordArray(parsed.reparsedQuestions),
  ].map((rows) => ({ rows, chapters: rows.filter((row) => Boolean(textField(row, ["chapter", "section_path", "sectionPath", "section", "topic", "theme"]))).length }))
    .sort((left, right) => right.chapters - left.chapters || right.rows.length - left.rows.length);
  const best = candidates[0]?.rows ?? [];
  const byOrder = new Map<number, string>();
  best.forEach((row, index) => {
    const chapter = textField(row, ["chapter", "section_path", "sectionPath", "section", "topic", "theme"]);
    if (!chapter) return;
    byOrder.set(index + 1, chapter);
    const number = Number(textField(row, ["number", "question_number", "questionNumber"]));
    if (Number.isInteger(number) && number > 0) byOrder.set(number, chapter);
  });
  return byOrder;
}
function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stablePackageRows<T extends { id: number }>(rows: T[], packageName: string, packageNumber: number) {
  return [...rows]
    .sort((left, right) => stableHash(`${packageName}:${packageNumber}:${left.id}`) - stableHash(`${packageName}:${packageNumber}:${right.id}`) || left.id - right.id)
    .slice((packageNumber - 1) * MEDTECH_QUESTION_PACKAGE_SIZE, packageNumber * MEDTECH_QUESTION_PACKAGE_SIZE);
}

async function getQuestions(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const topic = url.searchParams.get("topic") || "";
  const wrongOnly = url.searchParams.get("wrongOnly") === "1";
  const practiceOnly = url.searchParams.get("mode") === "practice";
  const reviewOnly = url.searchParams.get("mode") === "review";
  const questionOrder = url.searchParams.get("questionOrder") === "random" ? "random" : "ordered";
  const packageNumber = Math.max(1, Math.floor(Number(url.searchParams.get("pack")) || 1));
  const unlockPackage = url.searchParams.get("unlock") === "1";
  const reviewIds = url.searchParams.get("ids")?.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0).slice(0, 50) ?? [];
  const reviewSessionId = Number(url.searchParams.get("sessionId")) || 0;
  const db = auth.db;
  const [reviewSession] = reviewOnly && reviewSessionId ? await db.select().from(medtechPracticeSessions).where(and(eq(medtechPracticeSessions.id, reviewSessionId), eq(medtechPracticeSessions.userKey, auth.userKey))).limit(1) : [];
  let wrongIds: number[] = [];
  if (wrongOnly) {
    const attempts = await db.select({ questionId: examAttempts.questionId, correct: examAttempts.correct }).from(examAttempts).where(eq(examAttempts.userKey, auth.userKey)).orderBy(desc(examAttempts.id));
    const latest = new Map<number, boolean | null>();
    for (const attempt of attempts) if (!latest.has(attempt.questionId)) latest.set(attempt.questionId, attempt.correct);
    wrongIds = [...latest].filter(([, correct]) => correct === false).map(([id]) => id);
    if (!wrongIds.length) return Response.json({ items: [], message: "目前沒有待複習的錯題。" });
  }
  const sourceDocuments = await db.select({ id: documents.id, storageKey: documents.storageKey, fileName: documents.fileName, subject: documents.subject }).from(documents).where(eq(documents.examCategory, "medtech"));
  const sourceById = new Map(sourceDocuments.map(document => [document.id, document]));
  const sourceByAlias = new Map(sourceDocuments.flatMap((document) => [[`document:${document.id}`, document], [document.storageKey, document], [document.fileName, document]] as const));
  const sourceFor = (row: { sourceUrl: string }) => sourceByAlias.get(row.sourceUrl) ?? sourceById.get(Number(row.sourceUrl.replace(/^document:/, "")));
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
    sourceOrder: examQuestions.sourceOrder,
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
  const allTopicRows = rows.filter((row) => {
    const source = sourceFor(row);
    return !topic || topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === topic;
  });
  // 章節刷題只取指定章節；隨機模考跨前三個知識章節，避免和「全真模擬試題」正式考卷重複。
  const topicRows = topic ? allTopicRows : allTopicRows.filter((row) => {
    const source = sourceFor(row);
    const sourceTopic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
    return sourceTopic !== topics[3];
  });
  const packageCount = Math.max(1, Math.ceil(topicRows.length / MEDTECH_QUESTION_PACKAGE_SIZE));
  let selectedRows = reviewOnly
    ? topicRows.filter((row) => (reviewSession ? parseIds(reviewSession.questionIdsJson).includes(row.id) : reviewIds.includes(row.id))).slice(0, limit)
    : practiceOnly && !wrongOnly
    ? stablePackageRows(topicRows, topic || "隨機模考", packageNumber)
    : topicRows.sort(() => Math.random() - .5).slice(0, limit);
  const packageMode = practiceOnly && !wrongOnly;
  const packageName = topic || "隨機模考";
  const access = reviewSession
    ? { usage: await getOrCreateMedtechUsage(db, auth.userKey), allowedIds: selectedRows.map((row) => row.id), limited: false }
    : packageMode
    ? await grantMedtechQuestionPackageAccess(db, auth.userKey, packageName, selectedRows.map((row) => row.id), { packageNumber, allowCharge: unlockPackage })
    : await grantMedtechQuestionAccess(db, auth.userKey, selectedRows.map((row) => row.id));
  if (packageMode) {
    const rowById = new Map(topicRows.map((row) => [row.id, row]));
    const packageIds: number[] = ("packageQuestionIds" in access ? access.packageQuestionIds : access.allowedIds) as number[];
    selectedRows = packageIds.map((id) => rowById.get(id)).filter((row): row is (typeof topicRows)[number] => Boolean(row));
  } else {
    if (selectedRows.length && !access.allowedIds.length) {
      return Response.json({ error: "點數不足；查看一題扣 1 點，同一題 7 天內可無限重做，請先購買點數。", code: "POINTS_EXHAUSTED", points: access.usage.aiCredits, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    }
    const allowedIds = new Set(access.allowedIds);
    selectedRows = selectedRows.filter((row) => allowedIds.has(row.id));
  }
  const questionIds = selectedRows.map((row) => row.id);
  const selectedSourceIds = [...new Set(selectedRows.map((row) => Number(row.sourceUrl.replace(/^document:/, ""))).filter((id) => Number.isInteger(id) && id > 0))];
  const sourceAnalyses = selectedSourceIds.length
    ? await db.select({ id: documents.id, processingResultJson: documents.processingResultJson }).from(documents).where(inArray(documents.id, selectedSourceIds))
    : [];
  const chapterBySourceId = new Map(sourceAnalyses.map((source) => [source.id, chapterByOrder(source.processingResultJson)]));
  const chapterOf = (row: { sourceUrl: string; sourceOrder: number | null }, source: { fileName?: string; subject?: string } | undefined) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const storedChapter = row.sourceOrder ? chapterBySourceId.get(sourceId)?.get(row.sourceOrder) : "";
    return storedChapter || topicOf(source?.fileName ?? "", source?.subject ?? "") || "章節未標示";
  };
  const cleanStem = (stem: string) => stem.replace(/（(\d{2,3}[.．](?:1|2|7)月專技)）\s*（\1）\s*$/u, "（$1）");

  // The exam-taking screen only needs question data. Do not load explanation
  // columns or optional audio/subtitle relations until a feature asks for
  // them; this also keeps a question-only mock exam independent of media.
  if (practiceOnly) {
    let mapped = selectedRows.map((row) => {
      const source = sourceFor(row);
      const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
      return {
        id: row.id,
        year: row.year,
        questionNumber: row.questionNumber,
        stem: cleanStem(row.stem),
        options: parseOptions(row.optionsJson),
        answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
        answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
        answerSource: row.answerSource,
        subject: row.subject,
        chapter: chapterOf(row, source),
        topic,
        locked: packageMode && access.limited,
      };
    });
    // Keep the package membership fixed. A new attempt can explicitly choose
    // the original package order or a shuffled question order; an existing
    // in-progress session is restored below before it is returned.
    if (packageMode && questionOrder === "random" && mapped.length > 1) mapped = shuffleRows(mapped);
    const packageCost = "packageCost" in access ? access.packageCost : 30;
    const allAccess = "allAccess" in access && access.allAccess;
    const packageAvailableUntil = "availableUntil" in access && access.availableUntil instanceof Date ? access.availableUntil : null;
    let session: typeof medtechPracticeSessions.$inferSelect | null = null;
    if (mapped.length && "hasAccess" in access && access.hasAccess) {
      const sessionPackageName = packageMode ? packageName : (wrongOnly ? "錯題複習" : "醫檢師練題");
      const sessionPackageType = packageMode ? (topic ? "chapter" : "random_mock") : "wrong_review";
      const questionIdsJson = JSON.stringify(mapped.map((item) => item.id));
      if (packageMode) {
        const candidates = await db.select().from(medtechPracticeSessions).where(and(
          eq(medtechPracticeSessions.userKey, auth.userKey),
          eq(medtechPracticeSessions.packageName, sessionPackageName),
          eq(medtechPracticeSessions.packNumber, packageNumber),
          isNull(medtechPracticeSessions.completedAt),
        )).orderBy(desc(medtechPracticeSessions.startedAt)).limit(10);
        const candidate = candidates.find((item) => sameIdSet(parseIds(item.questionIdsJson), mapped.map((row) => row.id)) && item.status !== "expired");
        if (candidate) {
          session = candidate;
          mapped = orderRowsByIds(mapped, parseIds(candidate.questionIdsJson));
        }
      }
      if (!session) {
        session = (await db.insert(medtechPracticeSessions).values({
          userKey: auth.userKey,
          packageName: sessionPackageName,
          packageType: sessionPackageType,
          packNumber: packageMode ? packageNumber : 1,
          questionIdsJson,
          startedAt: new Date(),
          lastActiveAt: new Date(),
          totalQuestions: mapped.length,
          status: "in_progress",
        }).returning())[0] ?? null;
      }
    }
    const sessionProgress = session ? {
      id: session.id,
      status: session.completedAt ? "completed" : session.status,
      startedAt: session.startedAt.toISOString(),
      lastActiveAt: session.lastActiveAt?.toISOString?.() ?? null,
      lastQuestionIndex: session.lastQuestionIndex,
      durationSeconds: session.durationSeconds,
      answeredQuestions: session.answeredQuestions,
      answerDetails: parseAnswerDetails(session.answerDetailsJson),
    } : null;
    return Response.json({ items: mapped, sessionId: session?.id ?? null, session: sessionProgress, points: access.usage.aiCredits, accessLimited: access.limited, packageAccess: packageMode ? {
      name: packageName,
      cost: packageCost,
      baseCost: allAccess ? 199 : "discountReward" in access && access.discountReward ? access.discountReward.baseCost : 30,
      questionCount: mapped.length,
      days: allAccess ? 30 : 7,
      packageNumber,
      packageCount,
      isBonus: "isBonusPack" in access && access.isBonusPack,
      locked: access.limited,
      gifted: "gifted" in access && access.gifted,
      charged: "charged" in access && access.charged,
      allAccess,
      discountReward: "discountReward" in access ? access.discountReward : null,
      needsUnlock: "needsUnlock" in access && access.needsUnlock,
      blockedByPrevious: "blockedByPrevious" in access && access.blockedByPrevious,
      availableUntil: packageAvailableUntil?.toISOString() ?? null,
    } : undefined, topics: topics.map((name) => ({ name, count: rows.filter((row) => {
      const source = sourceFor(row);
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
      const source = sourceFor(row);
      const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
      const detail = detailByQuestion.get(row.id);
      const fullExplanation = detail?.teacherCompleteExplanation || detail?.completeExplanation || detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation || "";
      return {
        id: row.id,
        year: row.year,
        questionNumber: row.questionNumber,
        stem: cleanStem(row.stem),
        options: parseOptions(row.optionsJson),
        answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
        answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
        explanation: detail?.explanation || "",
        answerSource: row.answerSource,
        subject: row.subject,
        chapter: chapterOf(row, source),
        topic,
        hasFullExplanation: Boolean(fullExplanation.trim()),
      };
    });
    return Response.json({ items: mapped, points: access.usage.aiCredits, accessLimited: access.limited });
  }
  // Only load media for the selected questions. Loading every audio row here
  // makes the following subtitle query exceed D1's bound-parameter limit.
  const mediaRows = questionIds.length
    ? await db.select({ id: listeningSolutions.id, questionId: listeningSolutions.questionId, audioStorageKey: listeningSolutions.audioStorageKey, year: listeningSolutions.year, subject: listeningSolutions.subject, questionText: listeningSolutions.questionText }).from(listeningSolutions).where(and(isNotNull(listeningSolutions.audioStorageKey), inArray(listeningSolutions.questionId, questionIds)))
    : [];
  const mediaIds = mediaRows.map((row) => row.id);
  const cueRows = mediaIds.length
    ? await db.select({ id: listeningSubtitleCues.id, listeningId: listeningSubtitleCues.listeningId, startSeconds: listeningSubtitleCues.startSeconds, endSeconds: listeningSubtitleCues.endSeconds, text: listeningSubtitleCues.text, sequence: listeningSubtitleCues.sequence }).from(listeningSubtitleCues).where(inArray(listeningSubtitleCues.listeningId, mediaIds))
    : [];
  const mediaByQuestion = new Map<number, { id: number; audioStorageKey: string | null; cues: typeof cueRows }>();
  const normalizeMediaText = (value: string) => value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  for (const media of mediaRows) {
    const cues = cueRows.filter((cue) => cue.listeningId === media.id).sort((left, right) => left.sequence - right.sequence);
    if (media.questionId && questionIds.includes(media.questionId)) mediaByQuestion.set(media.questionId, { id: media.id, audioStorageKey: media.audioStorageKey, cues });
  }
  // Older imports may have a listening row without a reliable questionId.
  // Match it back to the selected question using the stored exam text.
  for (const row of selectedRows) {
    if (mediaByQuestion.has(row.id)) continue;
    const stem = normalizeMediaText(row.stem);
    const match = mediaRows.find((media) => media.year === row.year && media.subject === row.subject && normalizeMediaText(media.questionText) === stem);
    if (match) mediaByQuestion.set(row.id, { id: match.id, audioStorageKey: match.audioStorageKey, cues: cueRows.filter((cue) => cue.listeningId === match.id).sort((left, right) => left.sequence - right.sequence) });
  }

  const mapped = selectedRows.map((row) => {
    const source = sourceFor(row);
    const topic = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
    const detail = detailByQuestion.get(row.id);
    return {
      id: row.id,
      year: row.year,
      questionNumber: row.questionNumber,
      stem: cleanStem(row.stem),
      options: parseOptions(row.optionsJson),
      answer: row.teacherAnswer || row.correctAnswer || row.simulatedAnswer,
      answerLabel: row.teacherAnswer || row.correctAnswer ? "正式答案" : "此為 AI 擬答",
      explanation: detail?.teacherCompleteExplanation || detail?.completeExplanation || detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation || detail?.explanation || "",
      explanationLabel: detail?.teacherCompleteExplanation || detail?.completeExplanation ? "完整解析" : detail?.aiCompleteExplanation || detail?.simulatedCompleteExplanation ? "AI 完整解析（此為 AI 版本）" : "解析",
      answerSource: row.answerSource,
      subject: row.subject,
      chapter: chapterOf(row, source),
      topic,
      audioUrl: mediaByQuestion.get(row.id)?.audioStorageKey ? `/api/listening/audio?id=${mediaByQuestion.get(row.id)!.id}` : "",
      subtitles: (mediaByQuestion.get(row.id)?.cues ?? []).map((cue) => ({ id: cue.id, segmentId: null, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text, sequence: cue.sequence })),
    };
  });
  return Response.json({ items: mapped, points: access.usage.aiCredits, accessLimited: access.limited, topics: topics.map((name) => ({ name, count: rows.filter((row) => { const source = sourceFor(row); return topicOf(source?.fileName ?? "", source?.subject ?? row.subject) === name; }).length })) });
}

export async function GET(request: Request) {
  try {
    return await getQuestions(request);
  } catch (error) {
    console.error("[medtech/questions] failed to load questions", error);
    return Response.json({ error: "題目讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as {
    action?: "save-progress" | "finalize";
    answers?: Array<{ questionId: number; answer: string }>;
    answerDetails?: Array<Partial<PracticeAnswerDetail>>;
    masteredQuestionId?: number;
    sessionId?: number;
    status?: "in_progress" | "paused" | "awaiting_submit";
    currentIndex?: number;
    elapsedSeconds?: number;
  };
  const db = auth.db;
  if (body.action === "save-progress") {
    const sessionId = Number(body.sessionId);
    if (!Number.isInteger(sessionId) || sessionId < 1) return Response.json({ error: "缺少作答紀錄" }, { status: 400 });
    const [session] = await db.select().from(medtechPracticeSessions).where(and(eq(medtechPracticeSessions.id, sessionId), eq(medtechPracticeSessions.userKey, auth.userKey))).limit(1);
    if (!session) return Response.json({ error: "找不到作答紀錄" }, { status: 404 });
    if (session.completedAt || session.status === "completed") return Response.json({ saved: false, status: "completed" });
    const questionIds = new Set(parseIds(session.questionIdsJson));
    const details = (body.answerDetails ?? []).map((item, index): PracticeAnswerDetail | null => {
      const questionId = Number(item.questionId);
      if (!questionIds.has(questionId)) return null;
      const answer = typeof item.answer === "string" && /^[A-D]$/.test(item.answer) ? item.answer : null;
      return {
        questionId,
        order: Math.max(0, Math.floor(Number(item.order) || index)),
        answer,
        durationSeconds: Math.max(0, Math.min(604800, Math.floor(Number(item.durationSeconds) || 0))),
        answeredAt: typeof item.answeredAt === "string" ? item.answeredAt : null,
      };
    }).filter((item): item is PracticeAnswerDetail => Boolean(item)).filter((item, index, rows) => rows.findIndex((row) => row.questionId === item.questionId) === index);
    const status = body.status === "paused" || body.status === "awaiting_submit" ? body.status : "in_progress";
    const elapsedSeconds = Math.max(0, Math.min(604800, Math.floor(Number(body.elapsedSeconds) || 0)));
    const answeredQuestions = details.filter((item) => Boolean(item.answer)).length;
    await db.update(medtechPracticeSessions).set({
      status,
      lastActiveAt: new Date(),
      lastQuestionIndex: Math.max(0, Math.min(session.totalQuestions - 1, Math.floor(Number(body.currentIndex) || 0))),
      answerDetailsJson: JSON.stringify(details),
      durationSeconds: Math.max(session.durationSeconds, elapsedSeconds),
      answeredQuestions,
    }).where(eq(medtechPracticeSessions.id, session.id));
    return Response.json({ saved: true, status, sessionId: session.id, answeredQuestions, durationSeconds: Math.max(session.durationSeconds, elapsedSeconds) });
  }
  if (Number.isInteger(body.masteredQuestionId)) {
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, Number(body.masteredQuestionId)), eq(examQuestions.examCategory, "medtech"))).limit(1);
    if (!question) return Response.json({ error: "找不到醫檢師題目" }, { status: 404 });
    await db.insert(examAttempts).values({ userKey: auth.userKey, questionId: question.id, selectedAnswer: null, correct: true, gradingJson: JSON.stringify({ action: "mastered" }) });
    await db.insert(studyRecords).values({ userKey: auth.userKey, questionId: question.id, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師錯題複習", correct: true, weakness: "", nextStep: "已手動標記學會" });
    return Response.json({ mastered: true, questionId: question.id });
  }
  const answers = (body.answers ?? []).filter((item) => Number.isInteger(item.questionId) && /^[A-D]$/.test(item.answer));
  if (!answers.length) return Response.json({ saved: 0 });
  const questions = await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, answers.map((item) => item.questionId))));
  const previousAttempts = await db.select({ questionId: examAttempts.questionId, correct: examAttempts.correct })
    .from(examAttempts)
    .where(and(eq(examAttempts.userKey, auth.userKey), inArray(examAttempts.questionId, answers.map((item) => item.questionId))));
  const previouslyWrong = new Set(previousAttempts.filter((attempt) => attempt.correct === false).map((attempt) => attempt.questionId));
  const results: Array<{ questionId: number; correct: boolean; weakness: string }> = [];
  let saved = 0;
  for (const item of answers) {
    const question = questions.find((row) => row.id === item.questionId);
    if (!question) continue;
    const activeAnswer = question.teacherAnswer || question.correctAnswer || question.simulatedAnswer || "";
    if (!activeAnswer) continue;
    const correct = item.answer === activeAnswer;
    const weakness = correct ? "" : (topicOf("", question.subject) ?? (question.subject || topics[0]));
    await db.insert(examAttempts).values({ userKey: auth.userKey, questionId: item.questionId, selectedAnswer: item.answer, correct });
    await db.insert(studyRecords).values({ userKey: auth.userKey, questionId: item.questionId, recordDate: taipeiDate(), subject: "臨床病毒學", title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "醫檢師練題", correct, weakness, nextStep: correct ? "已掌握" : "加入錯題複習" });
    results.push({ questionId: item.questionId, correct, weakness });
    saved += 1;
  }
  const sessionId = Number(body.sessionId);
  if (Number.isInteger(sessionId) && sessionId > 0) {
    const [session] = await db.select().from(medtechPracticeSessions).where(and(eq(medtechPracticeSessions.id, sessionId), eq(medtechPracticeSessions.userKey, auth.userKey))).limit(1);
    if (session) {
      if (session.completedAt || session.status === "completed") return Response.json({ saved, session: { id: session.id, completed: true, status: "completed", durationSeconds: session.durationSeconds, totalQuestions: session.totalQuestions, answeredQuestions: session.answeredQuestions, correctQuestions: session.correctQuestions } });
      // The browser sends the complete set of selected answers on交卷.  Do not
      // use results.length here: a legacy question without a stored official
      // answer is skipped from grading, but it is still a question the learner
      // has answered and must not block the next pack's reward flow.
      const sessionQuestionIds = new Set(parseIds(session.questionIdsJson));
      const answeredIds = new Set(answers.filter((item) => sessionQuestionIds.has(item.questionId)).map((item) => item.questionId));
      const answeredCount = answeredIds.size;
      const completed = answeredCount >= session.totalQuestions;
      const completedAt = completed ? new Date() : null;
      const incorrectIds = results.filter((item) => !item.correct).map((item) => item.questionId);
      const repeatedWrongIds = incorrectIds.filter((id) => previouslyWrong.has(id));
      const weaknessCounts = new Map<string, number>();
      for (const item of results) if (!item.correct && item.weakness) weaknessCounts.set(item.weakness, (weaknessCounts.get(item.weakness) ?? 0) + 1);
      const weaknesses = [...weaknessCounts.entries()].sort((left, right) => right[1] - left[1]).map(([label, count]) => ({ label, count }));
      const savedDetails = parseAnswerDetails(JSON.stringify(body.answerDetails ?? []));
      const savedDetailsById = new Map(savedDetails.map((item) => [item.questionId, item]));
      for (const [order, item] of results.entries()) {
        const answer = answers.find((candidate) => candidate.questionId === item.questionId)?.answer ?? null;
        const prior = savedDetailsById.get(item.questionId);
        savedDetailsById.set(item.questionId, {
          questionId: item.questionId,
          order,
          answer,
          durationSeconds: prior?.durationSeconds ?? 0,
          answeredAt: prior?.answeredAt ?? new Date().toISOString(),
          correct: item.correct,
        });
      }
      const durationSeconds = Math.max(0, Math.min(604800, Math.floor(Number(body.elapsedSeconds) || Math.round(((completedAt ?? new Date()).getTime() - session.startedAt.getTime()) / 1000))));
      await db.update(medtechPracticeSessions).set({
        completedAt,
        status: completed ? "completed" : "awaiting_submit",
        lastActiveAt: new Date(),
        answerDetailsJson: JSON.stringify([...savedDetailsById.values()].sort((left, right) => left.order - right.order)),
        durationSeconds,
        answeredQuestions: answeredCount,
        correctQuestions: results.filter((item) => item.correct).length,
        incorrectQuestionIdsJson: JSON.stringify(incorrectIds),
        repeatedWrongQuestionIdsJson: JSON.stringify(repeatedWrongIds),
        weaknessesJson: JSON.stringify(weaknesses),
      }).where(eq(medtechPracticeSessions.id, session.id));
      const nextStep = !completed ? "本關尚未完成，請回到本關補完全部題目後再解鎖下一關" : weaknesses.length ? `優先加強：${weaknesses.slice(0, 3).map((item) => item.label).join("、")}；再做錯題複習與老師語音解析` : "維持練習，挑戰下一包題目";
      await db.insert(studyRecords).values({
        userKey: auth.userKey,
        recordDate: taipeiDate(),
        subject: "臨床病毒學",
        title: `${session.packageName}｜刷題分析`,
        activityType: "醫檢師刷題統計",
        plannedMinutes: Math.ceil(durationSeconds / 60),
        actualMinutes: Math.ceil(durationSeconds / 60),
        reflection: JSON.stringify({ sessionId: session.id, totalQuestions: session.totalQuestions, answeredQuestions: answeredCount, correctQuestions: results.filter((item) => item.correct).length, incorrectIds, repeatedWrongIds }),
        weakness: weaknesses.map((item) => `${item.label}（${item.count}題）`).join("；"),
        nextStep,
      });
      return Response.json({ saved, session: { id: session.id, completed, status: completed ? "completed" : "awaiting_submit", durationSeconds, totalQuestions: session.totalQuestions, answeredQuestions: answeredCount, correctQuestions: results.filter((item) => item.correct).length, incorrectQuestionIds: incorrectIds, repeatedWrongQuestionIds: repeatedWrongIds, weaknesses, nextStep } });
    }
  }
  return Response.json({ saved });
}
