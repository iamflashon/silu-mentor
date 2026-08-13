import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions } from "../../../../db/schema";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;
    const db = await getDb();
    const fields = { id: examQuestions.id, examName: examQuestions.examName, questionNumber: examQuestions.questionNumber, examType: examQuestions.examType, stem: examQuestions.stem, optionsJson: examQuestions.optionsJson };
    let rows = await db.select(fields).from(examQuestions).where(sql`${examQuestions.examCategory} = 'accounting' AND ${examQuestions.status} = 'published'`).orderBy(sql`random()`).limit(1);
    if (!rows.length) rows = await db.select(fields).from(examQuestions).where(eq(examQuestions.examCategory, "accounting")).orderBy(sql`random()`).limit(1);
    const question = rows[0];
    if (!question) return Response.json({ error: "中會題庫目前沒有可供驗證的題目。" }, { status: 404 });
    let options = "";
    try {
      const parsed = JSON.parse(question.optionsJson || "{}") as Record<string, string>;
      options = Object.entries(parsed).filter(([, value]) => value?.trim()).map(([key, value]) => `${key}. ${removeAccountingPageFurniture(value)}`).join("\n");
    } catch { /* 題目可能不是選擇題 */ }
    const rawStem = removeAccountingPageFurniture(question.stem).trim();
    const throughChoiceD = rawStem.match(/^([\s\S]*?\n\s*D[.、．)）]\s*[^\n]+)/u)?.[1];
    const stem = (throughChoiceD || rawStem.split(/\n\s*(?:|→|【?解析】?|【?答案】?|補充分錄|解答[:：])/u)[0]).trim();
    const confusion = question.examType === "mcq" ? "我不太確定這題應該先判斷哪個會計觀念，也不知道各選項錯在哪裡，請依老師教材教我。" : "我看不懂這題要先用哪個準則、公式或分錄，請依老師教材一步一步教我。";
    return Response.json({ prompt: `我在老師題庫看到這一題：\n\n${stem}${options && !throughChoiceD ? `\n\n${options}` : ""}\n\n${confusion}`, source: `${question.examName}｜第 ${question.questionNumber} 題`, questionId: question.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "無法從中會題庫抽題" }, { status: 500 });
  }
}
