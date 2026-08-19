import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions } from "../../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function readMeta(source: string | null) {
  try {
    return source ? (JSON.parse(source) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapMessage(message: typeof chatMessages.$inferSelect) {
  return {
    id: message.id,
    speaker: message.role,
    text: message.text,
    model: message.model || undefined,
    ...readMeta(message.source),
  };
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const key = userKey(request);
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.userKey, key), eq(chatSessions.contextType, "study-group")))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(80);
    const allMessages = sessions.length
      ? await db
          .select()
          .from(chatMessages)
          .where(inArray(chatMessages.sessionId, sessions.map((session) => session.id)))
          .orderBy(asc(chatMessages.id))
      : [];
    return Response.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        topic: session.title,
        mood: session.summary || "natural",
        updatedAt: session.updatedAt,
        messages: allMessages
          .filter((message) => message.sessionId === session.id)
          .map(mapMessage),
      })),
    });
  } catch {
    return Response.json({ error: "讀書會紀錄暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const key = userKey(request);
    const body = (await request.json()) as {
      sessionId?: number | null;
      topic?: string;
      mood?: string;
      messages?: Array<{
        speaker: string;
        text: string;
        model?: string;
        quote?: string;
        challengedSpeaker?: string;
        inputTokens?: number;
        outputTokens?: number;
        durationMs?: number;
        imageUrl?: string;
        attachmentUrl?: string;
        attachmentName?: string;
        attachmentType?: string;
        attachmentTask?: string;
      }>;
    };
    let sessionId = Number(body.sessionId || 0);
    if (sessionId) {
      const [owned] = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userKey, key), eq(chatSessions.contextType, "study-group")))
        .limit(1);
      if (!owned) return Response.json({ error: "找不到這場讀書會" }, { status: 404 });
      await db
        .update(chatSessions)
        .set({ title: body.topic?.trim() || "AI 讀書會", summary: body.mood || "natural", updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    } else {
      const [created] = await db
        .insert(chatSessions)
        .values({
          userKey: key,
          title: body.topic?.trim() || "AI 讀書會",
          summary: body.mood || "natural",
          progressStatus: "active",
          contextType: "study-group",
          updatedAt: new Date(),
        })
        .returning({ id: chatSessions.id });
      sessionId = created.id;
    }
    const messages = (body.messages || []).filter((message) => message.text?.trim());
    if (messages.length) {
      await db.insert(chatMessages).values(
        messages.map((message) => ({
          sessionId,
          role: message.speaker,
          text: message.text,
          model: message.model || null,
          source: JSON.stringify({
            quote: message.quote,
            challengedSpeaker: message.challengedSpeaker,
            inputTokens: message.inputTokens,
            outputTokens: message.outputTokens,
            durationMs: message.durationMs,
            imageUrl: message.imageUrl,
            attachmentUrl: message.attachmentUrl,
            attachmentName: message.attachmentName,
            attachmentType: message.attachmentType,
            attachmentTask: message.attachmentTask,
          }),
        })),
      );
    }
    return Response.json({ sessionId });
  } catch {
    return Response.json({ error: "讀書會紀錄暫時無法保存" }, { status: 503 });
  }
}
