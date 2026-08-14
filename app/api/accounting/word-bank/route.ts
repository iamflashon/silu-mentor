import { like } from "drizzle-orm";
import records from "../../../../data/accounting-word-bank.json";
import { getDb } from "../../../../db";
import { examQuestions } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

type WordBankRecord = {
  examType: string;
  examCategory: string;
  year: string;
  examName: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string;
  teacherNotes: string;
  answerSource: string;
  sourceUrl: string;
  status: string;
};

const SOURCE_PREFIX = "accounting-word-bank:%";
const PUBLIC_SOURCE = "115年會計研究所班 中級會計學";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const db = await getDb();
  const current = await db.select({ id: examQuestions.id }).from(examQuestions).where(like(examQuestions.sourceUrl, SOURCE_PREFIX));
  return Response.json({ available: records.length, imported: current.length, source: PUBLIC_SOURCE });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const db = await getDb();
  const sourceRecords = records as WordBankRecord[];
  if (!sourceRecords.length) return Response.json({ error: "Word 題庫資料為空" }, { status: 422 });
  if (sourceRecords.some((row) => row.examName !== PUBLIC_SOURCE || !row.sourceUrl.startsWith("accounting-word-bank:"))) {
    return Response.json({ error: "Word 題庫來源隔離檢查失敗" }, { status: 422 });
  }
  await db.delete(examQuestions).where(like(examQuestions.sourceUrl, SOURCE_PREFIX));
  let imported = 0;
  for (let offset = 0; offset < sourceRecords.length; offset += 20) {
    const batch = sourceRecords.slice(offset, offset + 20).map((row) => ({
      examType: "mcq",
      examCategory: "accounting",
      year: row.year,
      examName: PUBLIC_SOURCE,
      subject: "中級會計學",
      questionNumber: row.questionNumber,
      stem: row.stem,
      optionsJson: JSON.stringify(row.options),
      correctAnswer: row.correctAnswer,
      explanation: row.explanation,
      teacherAnswer: "",
      teacherNotes: row.teacherNotes,
      answerSource: row.answerSource,
      answerStatus: "source_matched",
      sourceUrl: row.sourceUrl,
      status: "published",
    }));
    await db.insert(examQuestions).values(batch);
    imported += batch.length;
  }
  return Response.json({ imported, source: PUBLIC_SOURCE, status: "published" });
}
