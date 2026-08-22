import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, examQuestions, examSources } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb();
  const totals = await db.select({
    examCategory: examQuestions.examCategory,
    total: sql<number>`count(*)`,
    published: sql<number>`coalesce(sum(case when ${examQuestions.status} = 'published' then 1 else 0 end), 0)`,
    draft: sql<number>`coalesce(sum(case when ${examQuestions.status} != 'published' then 1 else 0 end), 0)`,
    reviewed: sql<number>`coalesce(sum(case when ${examQuestions.reviewStatus} in ('reviewed', 'approved') then 1 else 0 end), 0)`,
  }).from(examQuestions).groupBy(examQuestions.examCategory);
  const files = await db.select({
    id: documents.id,
    examCategory: documents.examCategory,
    bookTitle: documents.bookTitle,
    fileName: documents.fileName,
    subject: documents.subject,
    documentType: documents.documentType,
    status: documents.status,
    pageCount: documents.pageCount,
    questionCount: documents.questionCount,
    processedAt: documents.processedAt,
  }).from(documents).orderBy(desc(documents.processedAt), desc(documents.createdAt)).limit(120);
  const urlSources = await db.select().from(examSources).orderBy(desc(examSources.updatedAt));
  const url = new URL(request.url);
  const category = url.searchParams.get("category")?.trim() ?? "";
  const subject = url.searchParams.get("subject")?.trim() ?? "";
  const year = url.searchParams.get("year")?.trim() ?? "";
  const examType = url.searchParams.get("examType")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const query = url.searchParams.get("query")?.trim() ?? "";
  const filters = [
    category && category !== "all" ? eq(examQuestions.examCategory, category) : undefined,
    subject ? eq(examQuestions.subject, subject) : undefined,
    year ? eq(examQuestions.year, year) : undefined,
    examType ? eq(examQuestions.examType, examType) : undefined,
    status ? eq(examQuestions.status, status) : undefined,
    query ? or(
      like(examQuestions.stem, `%${query}%`),
      like(examQuestions.explanation, `%${query}%`),
      like(examQuestions.examName, `%${query}%`),
      like(examQuestions.questionNumber, `%${query}%`),
    ) : undefined,
  ].filter(Boolean);
  const questions = await db.select({
    id: examQuestions.id,
    examCategory: examQuestions.examCategory,
    examType: examQuestions.examType,
    year: examQuestions.year,
    examName: examQuestions.examName,
    subject: examQuestions.subject,
    questionNumber: examQuestions.questionNumber,
    stem: examQuestions.stem,
    status: examQuestions.status,
    reviewStatus: examQuestions.reviewStatus,
  }).from(examQuestions).where(filters.length ? and(...filters as Parameters<typeof and>) : undefined).orderBy(desc(examQuestions.id)).limit(100);
  const subjects = await db.select({ value: examQuestions.subject }).from(examQuestions).groupBy(examQuestions.subject).orderBy(examQuestions.subject);
  const years = await db.select({ value: examQuestions.year }).from(examQuestions).groupBy(examQuestions.year).orderBy(desc(examQuestions.year));
  const packageRows = await db.select().from(appSettings).where(like(appSettings.key, "central_question_pack:%")).orderBy(desc(appSettings.updatedAt)).limit(30);
  return Response.json({
    totals: totals.map((row) => ({ ...row, total: Number(row.total), published: Number(row.published), draft: Number(row.draft), reviewed: Number(row.reviewed) })),
    files: files.filter((file) => Number(file.questionCount) > 0).map((file) => ({ ...file, questionCount: Number(file.questionCount), pageCount: Number(file.pageCount ?? 0) })),
    urlSources: urlSources.map((source) => ({ ...source, examCategory: "law", discoveredCount: Number(source.discoveredCount), processedCount: Number(source.processedCount), questionCount: Number(source.questionCount) })),
    questions,
    subjects: subjects.map((row) => row.value).filter(Boolean),
    years: years.map((row) => row.value).filter(Boolean),
    packages: packageRows.map((row) => { try { return JSON.parse(row.value); } catch { return null; } }).filter(Boolean),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { name?: unknown; examCategory?: unknown; questionIds?: unknown; description?: unknown };
  const name = String(body.name ?? "").trim();
  const examCategory = String(body.examCategory ?? "").trim();
  const questionIds = Array.isArray(body.questionIds) ? [...new Set(body.questionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
  if (!name) return Response.json({ error: "請輸入組合包名稱" }, { status: 400 });
  if (!examCategory || examCategory === "all") return Response.json({ error: "組合包必須指定一個使用平台" }, { status: 400 });
  if (!questionIds.length) return Response.json({ error: "請至少勾選一題" }, { status: 400 });
  const db = await getDb();
  const now = new Date();
  const key = `central_question_pack:${examCategory}:${Date.now()}`;
  const value = JSON.stringify({ key, name, examCategory, description: String(body.description ?? "").trim(), questionIds, questionCount: questionIds.length, status: "draft", createdAt: now.toISOString() });
  await db.insert(appSettings).values({ key, value, updatedAt: now });
  return Response.json({ package: JSON.parse(value) });
}
