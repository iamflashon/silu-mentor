import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions } from "../../../db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const status = url.searchParams.get("status") || "draft";
  const examType = url.searchParams.get("examType") || "all";
  const year = url.searchParams.get("year") || "all";
  const subject = url.searchParams.get("subject") || "all";
  const filters = [eq(examQuestions.status, status)];
  if (examType !== "all") filters.push(eq(examQuestions.examType, examType));
  if (year !== "all") filters.push(eq(examQuestions.year, year));
  if (subject !== "all") filters.push(eq(examQuestions.subject, subject));
  const db = await getDb();
  const where = and(...filters);
  const facetWhere = eq(examQuestions.status, status);
  const [items, countRows, totals, typeTotals, years, subjects] = await Promise.all([
    db.select().from(examQuestions).where(where).orderBy(desc(examQuestions.id)).limit(10).offset((page - 1) * 10),
    db.select({ count: sql<number>`count(*)` }).from(examQuestions).where(where),
    db.select({ status: examQuestions.status, count: sql<number>`count(*)` }).from(examQuestions).groupBy(examQuestions.status),
    db.select({ examType: examQuestions.examType, count: sql<number>`count(*)` }).from(examQuestions).where(facetWhere).groupBy(examQuestions.examType),
    db.selectDistinct({ year: examQuestions.year }).from(examQuestions).where(facetWhere).orderBy(asc(examQuestions.year)),
    db.selectDistinct({ subject: examQuestions.subject }).from(examQuestions).where(facetWhere).orderBy(asc(examQuestions.subject)),
  ]);
  return Response.json({ items, total: Number(countRows[0]?.count ?? 0), page, totals: Object.fromEntries(totals.map((row) => [row.status, Number(row.count)])), examTypeTotals: Object.fromEntries(typeTotals.map((row) => [row.examType, Number(row.count)])), filters: { years: years.map((row) => row.year), subjects: subjects.map((row) => row.subject) } });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { id?: number; ids?: number[]; status?: string; publishAllDrafts?: boolean };
  const db = await getDb();
  if (body.publishAllDrafts) {
    const rows = await db.update(examQuestions).set({ status: "published" }).where(eq(examQuestions.status, "draft")).returning({ id: examQuestions.id });
    return Response.json({ updated: rows.length });
  }
  const ids = body.ids?.length ? body.ids : body.id ? [body.id] : [];
  if (!ids.length || !["draft", "published"].includes(body.status || "")) return Response.json({ error: "缺少題目或狀態" }, { status: 400 });
  const rows = await db.update(examQuestions).set({ status: body.status! }).where(inArray(examQuestions.id, ids)).returning({ id: examQuestions.id });
  return Response.json({ updated: rows.length });
}
