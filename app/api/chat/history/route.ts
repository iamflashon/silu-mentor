import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions, studyPlans, studyRecords, studyTasks } from "../../../../db/schema";
import { taipeiDate, taipeiGreeting } from "../../../../lib/taipei-time";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.userKey, userKey(request))).orderBy(desc(chatSessions.updatedAt)).limit(1);
    const messages = session
      ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session.id)).orderBy(asc(chatMessages.id)).limit(80)
      : [];
    const today = taipeiDate();
    const [activePlan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
    const todayTasks = activePlan
      ? await db.select().from(studyTasks).where(and(eq(studyTasks.planId, activePlan.id), eq(studyTasks.taskDate, today))).orderBy(asc(studyTasks.id))
      : [];
    const todayRecords = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, userKey(request)), eq(studyRecords.recordDate, today))).orderBy(desc(studyRecords.createdAt)).limit(30);
    return Response.json({
      sessionId: session?.id ?? null,
      messages: messages.map((message) => { let sources: string[] = []; try { sources = message.citationsJson ? JSON.parse(message.citationsJson) as string[] : []; } catch { sources = []; } return { role: message.role, text: message.text, source: message.source, model: message.model, sources }; }),
      today,
      plan: activePlan ? { id: activePlan.id, title: activePlan.title, targetLabel: activePlan.targetLabel, dailyMinutes: activePlan.dailyMinutes } : null,
      todayTasks,
      greeting: taipeiGreeting(),
      todayRecords: todayRecords.map((record) => ({ subject: record.subject, title: record.title, activityType: record.activityType, actualMinutes: record.actualMinutes, nextStep: record.nextStep })),
    });
  } catch {
    return Response.json({ error: "學習紀錄暫時無法讀取" }, { status: 503 });
  }
}
