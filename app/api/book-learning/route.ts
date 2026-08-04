import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatMessages, chatSessions } from "../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resourceId = Number(url.searchParams.get("resourceId"));
  const segmentId = Number(url.searchParams.get("segmentId"));
  const db = await getDb();

  if (Number.isInteger(resourceId) && Number.isInteger(segmentId)) {
    const [session] = await db.select().from(chatSessions).where(and(
      eq(chatSessions.userKey, userKey(request)),
      eq(chatSessions.contextType, "book"),
      eq(chatSessions.resourceId, resourceId),
      eq(chatSessions.segmentId, segmentId),
    )).orderBy(desc(chatSessions.updatedAt)).limit(1);
    const messages = session ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session.id)).orderBy(asc(chatMessages.id)).limit(100) : [];
    return Response.json({ sessionId: session?.id ?? null, messages: messages.map((message) => ({ role: message.role, text: message.text })) });
  }

  const [last] = await db.select().from(chatSessions).where(and(
    eq(chatSessions.userKey, userKey(request)),
    eq(chatSessions.contextType, "book"),
  )).orderBy(desc(chatSessions.updatedAt)).limit(1);
  return Response.json({ resourceId: last?.resourceId ?? null, segmentId: last?.segmentId ?? null, updatedAt: last?.updatedAt ?? null });
}
