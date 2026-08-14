import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { examQuestions } from "../../../../../db/schema";
import { removeAccountingPageFurniture } from "../../../../../lib/accounting-question";

export async function GET(request: Request) {
  const url = new URL(request.url), documentId = Number(url.searchParams.get("documentId"));
  const db = await getDb();
  const where = and(eq(examQuestions.examCategory, "accounting"), ...(documentId > 0 ? [eq(examQuestions.sourceUrl, `document:${documentId}`)] : []));
  const [count] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(where);
  const items = await db.select().from(examQuestions).where(where).orderBy(asc(examQuestions.id)).limit(Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100))).offset(Math.max(0, Number(url.searchParams.get("page") || 1) - 1) * 100);
  return Response.json({ items: items.map(item => ({ ...item, stem: removeAccountingPageFurniture(item.stem), explanation: removeAccountingPageFurniture(item.explanation), teacherAnswer: removeAccountingPageFurniture(item.teacherAnswer), options: JSON.parse(item.optionsJson || "{}") })), total: Number(count?.total ?? 0) });
}

export async function PATCH(request: Request) {
  const body = await request.json() as Record<string, unknown>, id = Number(body.id), db = await getDb();
  const [existing] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "accounting"))).limit(1);
  if (!existing) return Response.json({ error: "找不到中會題目" }, { status: 404 });
  const update: Record<string, string> = {};
  for (const key of ["year", "subject", "questionNumber", "stem", "explanation", "teacherAnswer", "answerSource", "status"] as const) if (typeof body[key] === "string") update[key] = String(body[key]).trim();
  if (body.options && typeof body.options === "object") update.optionsJson = JSON.stringify(body.options);
  await db.update(examQuestions).set(update).where(eq(examQuestions.id, id));
  return Response.json({ updated: true });
}
