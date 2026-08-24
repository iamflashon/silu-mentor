import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatMessages, chatSessions } from "../../../../db/schema";
import { taipeiDate, taipeiGreeting } from "../../../../lib/taipei-time";

function visibleConversationText(text:string){return text.replace(/(?:\r?\n|\s)*(?:<!--\s*)?SILU_(?:PRACTICE_STATE|PRACTICE):[A-Za-z0-9_-]+(?:\s*-->)?/gi,"").replace(/\s+/g," ").trim()}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { sessionId?: number | null; continueConversation?: boolean };
    const db = await getDb();
    const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
    const currentId = Number(body.sessionId) || null;
    let carryoverSummary = "";
    if (currentId) {
      const [current] = await db.select().from(chatSessions).where(eq(chatSessions.id, currentId)).limit(1);
      if (current?.userKey === key) {
        if (body.continueConversation) {
          const previous = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, currentId)).orderBy(asc(chatMessages.id)).limit(100);
          const recent = previous.slice(-10).map((message) => `${message.role === "student" ? "學生" : "AI 導師"}：${visibleConversationText(message.text).slice(0, 240)}`).filter((line)=>!/[：:]\s*$/.test(line));
          carryoverSummary = recent.join("\n").slice(0, 1800);
        }
        await db.update(chatSessions).set({ progressStatus: "completed", summary: carryoverSummary || current.summary, updatedAt: new Date() }).where(eq(chatSessions.id, currentId));
      }
    }
    const today = taipeiDate();
    const [created] = await db.insert(chatSessions).values({
      userKey: key,
      sessionDate: today,
      title: body.continueConversation ? `${today}｜對話續篇` : `${today}｜新主題`,
      progressStatus: "active",
      contextType: "home",
    }).returning();
    return Response.json({
      sessionId: created.id,
      greeting: body.continueConversation
        ? `本段對話較長，已保存原紀錄並整理成續篇。\n\n接續摘要：\n${carryoverSummary || "已保留上一段對話的最後學習位置。"}`
        : `${taipeiGreeting()}，新主題已經準備好了。這次要從哪一個問題開始？`,
      carryoverSummary,
    });
  } catch {
    return Response.json({ error: "目前無法開啟新主題，原對話仍然保留" }, { status: 503 });
  }
}
