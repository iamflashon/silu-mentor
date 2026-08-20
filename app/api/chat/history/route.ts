import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions, studyPlans, studyRecords, studyTasks } from "../../../../db/schema";
import { taipeiDate, taipeiGreeting } from "../../../../lib/taipei-time";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function previousDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1, 12));
  return date.toISOString().slice(0, 10);
}

function sessionDate(session: { sessionDate?: string | null; createdAt: Date; updatedAt: Date }) {
  return session.sessionDate || taipeiDate(session.updatedAt || session.createdAt);
}

function mapMessage(message: typeof chatMessages.$inferSelect) {
  const text = message.text;
  let sources: string[] = [];
  try { sources = message.citationsJson ? JSON.parse(message.citationsJson) as string[] : []; } catch { sources = []; }
  let comparison: unknown = undefined;
  try { comparison = message.comparisonJson ? JSON.parse(message.comparisonJson) : undefined; } catch { comparison = undefined; }
  const marker = text.match(/<!--\s*SILU_PRACTICE:([A-Za-z0-9_-]+)\s*-->/i);
  let practiceQuestion: unknown = undefined;
  if (marker) {
    try { practiceQuestion = JSON.parse(Buffer.from(marker[1], "base64url").toString("utf8")); } catch { practiceQuestion = undefined; }
  }
  const stateMarker = text.match(/<!--\s*SILU_PRACTICE_STATE:([A-Za-z0-9_-]+)\s*-->/i);
  let practiceState: unknown = undefined;
  if (stateMarker) {
    try { practiceState = JSON.parse(Buffer.from(stateMarker[1], "base64url").toString("utf8")); } catch { practiceState = undefined; }
  }
  const cleanedText = text
    .replace(/(?:\r?\n|\s)*(?:<!--\s*)?SILU_PRACTICE_STATE:[A-Za-z0-9_-]+(?:\s*-->)?/gi, "")
    .replace(/(?:\r?\n|\s)*(?:<!--\s*)?SILU_PRACTICE:[A-Za-z0-9_-]+(?:\s*-->)?/gi, "");
  return { role: message.role, text: cleanedText, source: message.source, model: message.model, sources, citationStatus: message.citationStatus, comparison, practiceQuestion, practiceState, createdAt: message.createdAt };
}

function buildSummary(messages: Array<typeof chatMessages.$inferSelect>) {
  const student = [...messages].reverse().find((message) => message.role === "student")?.text?.trim() ?? "";
  const mentor = [...messages].reverse().find((message) => message.role === "mentor")?.text?.trim() ?? "";
  return {
    messageCount: messages.length,
    lastStudent: student.slice(0, 180),
    lastMentor: mentor.slice(0, 240),
  };
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const key = userKey(request);
    const today = taipeiDate();
    const yesterdayDate = previousDate(today);
    const [activePlan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
    const todayTasks = activePlan
      ? await db.select().from(studyTasks).where(and(eq(studyTasks.planId, activePlan.id), eq(studyTasks.taskDate, today))).orderBy(asc(studyTasks.id))
      : [];
    const todayRecords = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, key), eq(studyRecords.recordDate, today))).orderBy(desc(studyRecords.createdAt)).limit(30);
    const yesterdayRecords = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, key), eq(studyRecords.recordDate, yesterdayDate))).orderBy(desc(studyRecords.createdAt)).limit(30);
    const yesterdayTasks = activePlan
      ? await db.select().from(studyTasks).where(and(eq(studyTasks.planId, activePlan.id), eq(studyTasks.taskDate, yesterdayDate))).orderBy(asc(studyTasks.id))
      : [];

    const sessions = await db.select().from(chatSessions).where(and(eq(chatSessions.userKey, key), eq(chatSessions.contextType, "home"))).orderBy(desc(chatSessions.updatedAt)).limit(120);
    const todaySession = sessions.find((session) => sessionDate(session) === today && session.progressStatus === "active")
      ?? sessions.find((session) => sessionDate(session) === today)
      ?? null;
    const yesterdaySession = sessions.find((session) => sessionDate(session) === yesterdayDate) ?? null;
    const currentMessages = todaySession
      ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, todaySession.id)).orderBy(asc(chatMessages.id)).limit(100)
      : [];
    const yesterdayMessages = yesterdaySession
      ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, yesterdaySession.id)).orderBy(asc(chatMessages.id)).limit(100)
      : [];
    const yesterdaySummary = buildSummary(yesterdayMessages);
    const unfinishedTasks = yesterdayTasks.filter((task) => task.status !== "completed");
    const completedTasks = yesterdayTasks.filter((task) => task.status === "completed");
    const yesterday = (yesterdaySession || yesterdayTasks.length || yesterdayRecords.length) ? {
      date: yesterdayDate,
      sessionId: yesterdaySession?.id ?? null,
      messageCount: yesterdaySummary.messageCount,
      lastStudent: yesterdaySummary.lastStudent,
      lastMentor: yesterdaySummary.lastMentor,
      completedTasks: completedTasks.length,
      totalTasks: yesterdayTasks.length,
      incompleteTasks: unfinishedTasks.map((task) => ({ id: task.id, subject: task.subject, title: task.title, durationMinutes: task.durationMinutes, details: task.details })),
      records: yesterdayRecords.map((record) => ({ subject: record.subject, title: record.title, activityType: record.activityType, actualMinutes: record.actualMinutes, correct: record.correct, weakness: record.weakness, nextStep: record.nextStep })),
    } : null;

    const archiveRequested = new URL(request.url).searchParams.get("archive") === "1";
    let archive: Array<Record<string, unknown>> = [];
    if (archiveRequested && sessions.length) {
      const ids = sessions.map((session) => session.id);
      const allMessages = await db.select().from(chatMessages).where(inArray(chatMessages.sessionId, ids)).orderBy(asc(chatMessages.id));
      archive = sessions.map((session) => {
        const messages = allMessages.filter((message) => message.sessionId === session.id);
        const summary = buildSummary(messages);
        return { id: session.id, date: sessionDate(session), title: session.title, summary: session.summary || summary.lastMentor, progressStatus: session.progressStatus, messageCount: messages.length, messages: messages.map(mapMessage) };
      });
    }

    return Response.json({
      sessionId: todaySession?.id ?? null,
      messages: currentMessages.map(mapMessage),
      today,
      plan: activePlan ? { id: activePlan.id, title: activePlan.title, targetLabel: activePlan.targetLabel, dailyMinutes: activePlan.dailyMinutes } : null,
      todayTasks,
      greeting: taipeiGreeting(),
      todayRecords: todayRecords.map((record) => ({ subject: record.subject, title: record.title, activityType: record.activityType, actualMinutes: record.actualMinutes, nextStep: record.nextStep })),
      yesterday,
      archive,
    });
  } catch {
    return Response.json({ error: "學習紀錄暫時無法讀取" }, { status: 503 });
  }
}
