import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatSessions } from "../../../../db/schema";
import { taipeiDate, taipeiGreeting } from "../../../../lib/taipei-time";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { sessionId?: number | null };
    const db = await getDb();
    const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
    const currentId = Number(body.sessionId) || null;
    if (currentId) {
      const [current] = await db.select().from(chatSessions).where(eq(chatSessions.id, currentId)).limit(1);
      if (current?.userKey === key) {
        await db.update(chatSessions).set({ progressStatus: "completed", updatedAt: new Date() }).where(eq(chatSessions.id, currentId));
      }
    }
    const today = taipeiDate();
    const [created] = await db.insert(chatSessions).values({
      userKey: key,
      sessionDate: today,
      title: `${today}｜新主題`,
      progressStatus: "active",
      contextType: "home",
    }).returning();
    return Response.json({
      sessionId: created.id,
      greeting: `${taipeiGreeting()}，新主題已經準備好了。這次要從哪一個問題開始？`,
    });
  } catch {
    return Response.json({ error: "目前無法開啟新主題，原對話仍然保留" }, { status: 503 });
  }
}
