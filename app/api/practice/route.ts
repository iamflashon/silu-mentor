import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examAttempts, examQuestions, studyRecords } from "../../../db/schema";
import { taipeiDate } from "../../../lib/taipei-time";
import { normalizeMcqOptions } from "../../../lib/exam-options";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const examType = url.searchParams.get("type") === "essay" ? "essay" : "mcq";
    const subject = (url.searchParams.get("subject") ?? "").trim();
    const year = (url.searchParams.get("year") ?? "").trim();
    const law = (url.searchParams.get("law") ?? "").trim();
    const questionId = Number(url.searchParams.get("questionId") ?? "");
    const excludeAnswered = url.searchParams.get("excludeAnswered") === "1";
    const wrongOnly = url.searchParams.get("wrongOnly") === "1";
    const db = await getDb();
    // 司律練真題只能讀取司律題庫；不同類科共用 examQuestions 表，
    // 因此不能只靠 examType 篩選，否則醫檢師／會計的一試題也會被抽到。
    const lawCategory = eq(examQuestions.examCategory, "law");
    const baseFilters = [lawCategory, eq(examQuestions.status, "published"), eq(examQuestions.examType, examType)];
    if (subject) baseFilters.push(eq(examQuestions.subject, subject));
    if (year) baseFilters.push(eq(examQuestions.year, year));
    if (law) baseFilters.push(sql`${examQuestions.stem} like ${`%${law}%`}`);
    if (Number.isInteger(questionId) && questionId > 0) baseFilters.push(eq(examQuestions.id, questionId));
    if (wrongOnly) {
      const attempts = await db.select({ questionId: examAttempts.questionId, correct: examAttempts.correct })
        .from(examAttempts)
        .where(eq(examAttempts.userKey, userKey(request)))
        .orderBy(desc(examAttempts.id));
      const latest = new Map<number, boolean | null>();
      for (const attempt of attempts) if (!latest.has(attempt.questionId)) latest.set(attempt.questionId, attempt.correct);
      const unresolvedWrongIds = [...latest.entries()].filter(([, correct]) => correct === false).map(([id]) => id);
      if (!unresolvedWrongIds.length) return Response.json({ question: null, message: "目前沒有待訂正錯題。之後答錯的題目會自動收進這裡。" });
      baseFilters.push(inArray(examQuestions.id, unresolvedWrongIds));
    }
    if (excludeAnswered) {
      const attempted = await db.selectDistinct({ questionId: examAttempts.questionId }).from(examAttempts).where(eq(examAttempts.userKey, userKey(request)));
      if (attempted.length) baseFilters.push(notInArray(examQuestions.id, attempted.map((row) => row.questionId)));
    }
    const where = and(...baseFilters);
    if (url.searchParams.get("facets") === "1") {
      const [years, subjects, stems] = await Promise.all([
        db.selectDistinct({ value: examQuestions.year }).from(examQuestions).where(and(lawCategory, eq(examQuestions.status, "published"), eq(examQuestions.examType, examType))).orderBy(sql`${examQuestions.year} desc`),
        db.selectDistinct({ value: examQuestions.subject }).from(examQuestions).where(and(lawCategory, eq(examQuestions.status, "published"), eq(examQuestions.examType, examType))).orderBy(examQuestions.subject),
        db.select({ stem: examQuestions.stem }).from(examQuestions).where(and(lawCategory, eq(examQuestions.status, "published"), eq(examQuestions.examType, examType))),
      ]);
      const counts = new Map<string, number>();
      for (const row of stems) {
        const matches = row.stem.match(/(?:刑法|民法|公司法|憲法|行政程序法|刑事訴訟法|民事訴訟法)第\s*\d+(?:\s*之\s*\d+)?\s*條/g) ?? [];
        for (const match of new Set(matches.map((item) => item.replace(/\s+/g, "")))) counts.set(match, (counts.get(match) ?? 0) + 1);
      }
      const frequentLaws = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([title, count]) => ({ title, count }));
      return Response.json({ years: years.map((row) => row.value).filter(Boolean), subjects: subjects.map((row) => row.value).filter(Boolean), frequentLaws });
    }
    if (url.searchParams.get("list") === "1") {
      const rows = await db.select({
        id: examQuestions.id,
        year: examQuestions.year,
        examName: examQuestions.examName,
        subject: examQuestions.subject,
        questionNumber: examQuestions.questionNumber,
        stem: examQuestions.stem,
        hasTeacherAnswer: examQuestions.teacherAnswer,
        answerSource: examQuestions.answerSource,
      }).from(examQuestions).where(where).orderBy(sql`${examQuestions.year} desc`, examQuestions.subject, examQuestions.questionNumber).limit(500);
      return Response.json({ questions: rows.map((row) => ({ ...row, hasTeacherAnswer: Boolean(row.hasTeacherAnswer?.trim()) })) });
    }
    const candidates = await db.select().from(examQuestions).where(where).orderBy(sql`random()`).limit(examType === "mcq" ? 80 : 1);
    const question = examType === "mcq"
      ? candidates.find((candidate) => Boolean(normalizeMcqOptions(candidate.optionsJson)))
      : candidates[0];
    if (!question) {
      const [published] = await db.select({ count: sql<number>`count(*)` }).from(examQuestions).where(and(lawCategory, eq(examQuestions.examType, examType), eq(examQuestions.status, "published")));
      const [drafts] = await db.select({ count: sql<number>`count(*)` }).from(examQuestions).where(and(lawCategory, eq(examQuestions.examType, examType), eq(examQuestions.status, "draft")));
      const publishedCount = Number(published?.count ?? 0);
      const draftCount = Number(drafts?.count ?? 0);
      const message = examType === "mcq"
        ? (draftCount ? `後台已有 ${draftCount} 題一試草稿，但尚未發布到前台。` : "一試真題庫尚未匯入可用題目")
        : (draftCount ? `後台已有 ${draftCount} 題二試申論草稿，但尚未發布到前台；請先完成老師擬答核對，再按「發布前台」。` : "二試申論真題庫尚未匯入可用題目");
      return Response.json({ question: null, publishedCount, draftCount, message });
    }
    const options = question.examType === "mcq" ? normalizeMcqOptions(question.optionsJson) : null;
    return Response.json({ question: { id: question.id, examType: question.examType, year: question.year, examName: question.examName, subject: question.subject, questionNumber: question.questionNumber, stem: question.stem, options, hasTeacherAnswer: Boolean(question.teacherAnswer?.trim()), teacherAnswer: question.examType === "essay" ? question.teacherAnswer : undefined, answerSource: question.answerSource, answerStatus: question.answerStatus } });
  } catch { return Response.json({ error: "真題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; answer?: string };
    const questionId = Number(body.questionId); const answer = String(body.answer ?? "").toUpperCase();
    if (!Number.isInteger(questionId) || !/^[ABCD]$/.test(answer)) return Response.json({ error: "作答資料不正確" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examCategory, "law"), eq(examQuestions.status, "published"))).limit(1);
    if (!question || question.examType !== "mcq" || !question.correctAnswer) return Response.json({ error: "找不到可作答的選擇題" }, { status: 404 });
    const correctAnswer = question.correctAnswer.toUpperCase(); const correct = answer === correctAnswer;
    await db.insert(examAttempts).values({ userKey: userKey(request), questionId, selectedAnswer: answer, correct });
    const date = taipeiDate();
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: date, subject: question.subject, title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "一試練題", correct, weakness: correct ? "" : "本題觀念或選項判斷待補強", nextStep: correct ? "說明其他選項錯誤理由" : "回顧判斷關鍵並重做本題" });
    return Response.json({ correct, correctAnswer, guidance: correct ? "答對了。先別急著看完整解析：你能說說其他三個選項各錯在哪裡嗎？" : `這題正確答案是 ${correctAnswer}。先不公布完整解析：你當時選 ${answer} 的判斷關鍵是什麼？` });
  } catch { return Response.json({ error: "作答暫時無法儲存" }, { status: 500 }); }
}
