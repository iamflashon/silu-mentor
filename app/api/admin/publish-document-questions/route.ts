import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { documentIds?: number[] };
  const documentIds = [...new Set((body.documentIds ?? []).map(Number).filter(Number.isFinite))];
  if (!documentIds.length) return Response.json({ error: "缺少教材文件" }, { status: 400 });
  const sources = documentIds.map((id) => `document:${id}`);
  const db = await getDb();
  const rows = await db.select({ id: examQuestions.id, examType: examQuestions.examType, teacherAnswer: examQuestions.teacherAnswer })
    .from(examQuestions).where(and(inArray(examQuestions.sourceUrl, sources), eq(examQuestions.status, "draft")));
  const publishable = rows.filter((row) => row.examType !== "essay" || row.teacherAnswer?.trim()).map((row) => row.id);
  const blocked = rows.length - publishable.length;
  if (publishable.length) await db.update(examQuestions).set({ status: "published", updatedAt: new Date() }).where(inArray(examQuestions.id, publishable));
  return Response.json({ updated: publishable.length, blocked, totalDrafts: rows.length });
}
