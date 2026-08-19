import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions } from "../../../../db/schema";
import { accountingQuestionFlags } from "../../../../lib/accounting-question";

export async function GET() {
  const db = await getDb();
  const rows = await db.select({ id: examQuestions.id, examName: examQuestions.examName, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem, teacherAnswer: examQuestions.teacherAnswer, explanation: examQuestions.explanation, teacherNotes: examQuestions.teacherNotes }).from(examQuestions).where(eq(examQuestions.examCategory, "accounting"));
  const issues = rows.flatMap(row => {
    const stem = accountingQuestionFlags(row.stem);
    const answer = accountingQuestionFlags(`${row.teacherAnswer}\n${row.explanation}`);
    const kinds = [stem.pageFurniture || answer.pageFurniture ? "跨頁標題" : "", stem.needsTableReview || answer.needsTableReview ? "表格欄位" : "", stem.brokenGlyphs || answer.brokenGlyphs ? "缺字元" : ""].filter(Boolean);
    return kinds.length ? [{ id: row.id, source: row.examName, questionNumber: row.questionNumber, kinds, page: row.teacherNotes.match(/原稿第\s*(\d+)\s*頁/u)?.[1] ?? "" }] : [];
  });
  const byKind = issues.flatMap(item => item.kinds).reduce<Record<string, number>>((totals, kind) => ({ ...totals, [kind]: (totals[kind] ?? 0) + 1 }), {});
  return Response.json({ total: rows.length, issueCount: issues.length, byKind, issues });
}
