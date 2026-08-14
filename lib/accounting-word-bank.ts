import { like, sql } from "drizzle-orm";
import records from "../data/accounting-word-bank.json";
import { getDb } from "../db";
import { examQuestions } from "../db/schema";

type WordBankRecord = {
  year: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string;
  teacherNotes: string;
  answerSource: string;
  sourceUrl: string;
};

export const ACCOUNTING_WORD_BANK_SOURCE = "115年會計研究所班 中級會計學";
export const ACCOUNTING_WORD_BANK_SIZE = records.length;
const SOURCE_PREFIX = "accounting-word-bank:%";
const CURRENT_SOURCE_PREFIX = "accounting-word-bank:v3:%";

export async function countAccountingWordBank(db: Awaited<ReturnType<typeof getDb>>) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(examQuestions).where(like(examQuestions.sourceUrl, CURRENT_SOURCE_PREFIX));
  return Number(row?.count ?? 0);
}

export async function importAccountingWordBank(db: Awaited<ReturnType<typeof getDb>>, force = false) {
  const current = await countAccountingWordBank(db);
  if (!force && current === ACCOUNTING_WORD_BANK_SIZE) return { imported: current, changed: false };
  await db.delete(examQuestions).where(like(examQuestions.sourceUrl, SOURCE_PREFIX));
  const sourceRecords = records as WordBankRecord[];
  let imported = 0;
  // D1 has a low bound-parameter ceiling; five records keep every statement below it.
  for (let offset = 0; offset < sourceRecords.length; offset += 5) {
    const batch = sourceRecords.slice(offset, offset + 5).map((row) => ({
      examType: "mcq",
      examCategory: "accounting",
      year: row.year,
      examName: ACCOUNTING_WORD_BANK_SOURCE,
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
  return { imported, changed: true };
}
