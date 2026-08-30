import { and, eq } from "drizzle-orm";
import { examQuestions } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { ACCOUNTING_QUESTION_BANK_CHAPTERS, accountingChapterForNotes } from "../../../../lib/accounting-book-chapters";

export async function GET(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "缺少文件編號" }, { status: 400 });
  const rows = await auth.db.select({ status: examQuestions.status, teacherNotes: examQuestions.teacherNotes }).from(examQuestions).where(and(eq(examQuestions.examCategory, "accounting"), eq(examQuestions.sourceUrl, `document:${documentId}`)));
  const counts = new Map<number, number>(); let unassigned = 0;
  for (const row of rows) { const chapter = accountingChapterForNotes(row.teacherNotes); if (chapter) counts.set(chapter.number, (counts.get(chapter.number) || 0) + 1); else unassigned += 1; }
  return Response.json({ total: rows.length, published: rows.filter((row) => row.status === "published").length, draft: rows.filter((row) => row.status !== "published").length, unassigned, ready: rows.length > 0 && unassigned === 0, chapters: ACCOUNTING_QUESTION_BANK_CHAPTERS.map((chapter) => ({ ...chapter, count: counts.get(chapter.number) || 0 })) }, { headers: { "cache-control": "no-store" } });
}
