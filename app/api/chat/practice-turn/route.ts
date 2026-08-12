import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions } from "../../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: number; messages?: Array<{ role?: string; text?: string }> };
    const sessionId = Number(body.sessionId);
    const turns = (Array.isArray(body.messages) ? body.messages : [])
      .filter((item) => (item.role === "student" || item.role === "mentor") && String(item.text ?? "").trim())
      .slice(0, 4)
      .map((item) => ({ role: item.role as "student" | "mentor", text: String(item.text).trim().slice(0, 4000) }));
    if (!Number.isInteger(sessionId) || !turns.length) return Response.json({ error: "缺少對話內容" }, { status: 400 });
    const db = await getDb();
    const [session] = await db.select().from(chatSessions).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userKey, userKey(request)), eq(chatSessions.contextType, "home"))).limit(1);
    if (!session) return Response.json({ error: "找不到首頁對話" }, { status: 404 });
    await db.insert(chatMessages).values(turns.map((turn) => ({ sessionId, role: turn.role, text: turn.text, source: "真題練習" })));
    await db.update(chatSessions).set({ updatedAt: new Date(), summary: turns.at(-1)?.text ?? session.summary, progressStatus: "active" }).where(eq(chatSessions.id, sessionId));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "真題對話暫時無法保存" }, { status: 503 });
  }
}
