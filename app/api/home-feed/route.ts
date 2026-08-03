import { desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { learningResources, listeningSolutions, resourceSegments } from "../../../db/schema";

export async function GET() {
  const db = await getDb();
  const resources = await db.select().from(learningResources).orderBy(desc(learningResources.updatedAt)).limit(20);
  const [listening] = await db.select({ id: listeningSolutions.id, title: listeningSolutions.title, year: listeningSolutions.year, subject: listeningSolutions.subject }).from(listeningSolutions).where(isNotNull(listeningSolutions.audioStorageKey)).orderBy(desc(listeningSolutions.updatedAt)).limit(1);
  const recommended = await db.select({ id: resourceSegments.id, resourceId: resourceSegments.resourceId, title: resourceSegments.title, summary: resourceSegments.summary, startSeconds: resourceSegments.startSeconds, importance: resourceSegments.importance }).from(resourceSegments).where(eq(resourceSegments.recommended, true)).orderBy(desc(resourceSegments.importance)).limit(5);
  return Response.json({
    book: resources.find((item) => item.resourceType === "book") ?? null,
    course: resources.find((item) => item.resourceType === "course") ?? null,
    magazine: resources.find((item) => item.resourceType === "magazine") ?? null,
    listening: listening ? { ...listening, audioUrl: `/api/listening/audio?id=${listening.id}` } : null,
    recommended,
    ticker: ["距離 116 年司律考試持續累積實力", "每日一法條：刑法第 271 條 殺人罪", "今日任務完成後，記得留下學習接續點"],
  });
}
