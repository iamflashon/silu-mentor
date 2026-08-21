import { desc, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions, examSources } from "../../../../db/schema";
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
  return Response.json({
    totals: totals.map((row) => ({ ...row, total: Number(row.total), published: Number(row.published), draft: Number(row.draft), reviewed: Number(row.reviewed) })),
    files: files.filter((file) => Number(file.questionCount) > 0).map((file) => ({ ...file, questionCount: Number(file.questionCount), pageCount: Number(file.pageCount ?? 0) })),
    urlSources: urlSources.map((source) => ({ ...source, examCategory: "law", discoveredCount: Number(source.discoveredCount), processedCount: Number(source.processedCount), questionCount: Number(source.questionCount) })),
  });
}
