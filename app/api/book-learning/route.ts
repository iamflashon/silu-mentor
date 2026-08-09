import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, chatSessions } from "../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function mapMessage(message: typeof chatMessages.$inferSelect) {
  return {
    role: message.role,
    text: message.text,
    model: message.model ?? undefined,
    createdAt: message.createdAt,
  };
}

function mapHistorySession(
  session: typeof chatSessions.$inferSelect,
  messages: Array<typeof chatMessages.$inferSelect>,
) {
  const last = messages[messages.length - 1];
  return {
    id: session.id,
    resourceId: session.resourceId,
    segmentId: session.segmentId,
    title: session.title,
    summary: session.summary || last?.text?.replace(/\s+/g, " ").slice(0, 180) || "",
    updatedAt: session.updatedAt,
    progressStatus: session.progressStatus,
    messageCount: messages.length,
    lastRole: last?.role ?? null,
    lastText: last?.text ?? "",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Number(null) is 0. Treating an omitted query parameter as session 0 made
  // the no-argument "resume my latest book" request return 404 instead of the
  // latest persisted session.
  const optionalNumber = (name: string) => {
    const value = url.searchParams.get(name);
    return value === null || value.trim() === "" ? Number.NaN : Number(value);
  };
  const resourceId = optionalNumber("resourceId");
  const segmentId = optionalNumber("segmentId");
  const requestedSessionId = optionalNumber("sessionId");
  const db = await getDb();

  if (Number.isInteger(requestedSessionId)) {
    const [session] = await db.select().from(chatSessions).where(and(
      eq(chatSessions.id, requestedSessionId),
      eq(chatSessions.userKey, userKey(request)),
      eq(chatSessions.contextType, "book"),
    )).limit(1);
    if (!session) return Response.json({ error: "找不到這段智能書學習紀錄" }, { status: 404 });
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id))
      .orderBy(asc(chatMessages.id))
      .limit(200);
    return Response.json({
      sessionId: session.id,
      resourceId: session.resourceId,
      segmentId: session.segmentId,
      title: session.title,
      updatedAt: session.updatedAt,
      messages: messages.map(mapMessage),
    });
  }

  if (Number.isInteger(resourceId) && !Number.isInteger(segmentId)) {
    const sessions = await db.select().from(chatSessions).where(and(
      eq(chatSessions.userKey, userKey(request)),
      eq(chatSessions.contextType, "book"),
      eq(chatSessions.resourceId, resourceId),
    )).orderBy(desc(chatSessions.updatedAt)).limit(80);
    const ids = sessions.map((session) => session.id);
    const messages = ids.length
      ? await db.select().from(chatMessages).where(inArray(chatMessages.sessionId, ids)).orderBy(asc(chatMessages.id))
      : [];
    return Response.json({
      history: sessions.map((session) => mapHistorySession(session, messages.filter((message) => message.sessionId === session.id))),
    });
  }

  if (Number.isInteger(resourceId) && Number.isInteger(segmentId)) {
    const [session] = await db.select().from(chatSessions).where(and(
      eq(chatSessions.userKey, userKey(request)),
      eq(chatSessions.contextType, "book"),
      eq(chatSessions.resourceId, resourceId),
      eq(chatSessions.segmentId, segmentId),
    )).orderBy(desc(chatSessions.updatedAt)).limit(1);
    const messages = session ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session.id)).orderBy(asc(chatMessages.id)).limit(200) : [];
    return Response.json({ sessionId: session?.id ?? null, messages: messages.map(mapMessage) });
  }

  const [last] = await db.select().from(chatSessions).where(and(
    eq(chatSessions.userKey, userKey(request)),
    eq(chatSessions.contextType, "book"),
  )).orderBy(desc(chatSessions.updatedAt)).limit(1);
  return Response.json({ sessionId: last?.id ?? null, resourceId: last?.resourceId ?? null, segmentId: last?.segmentId ?? null, updatedAt: last?.updatedAt ?? null });
}
