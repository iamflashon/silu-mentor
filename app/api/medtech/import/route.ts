import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import { inspectDocumentBytes } from "../../../../lib/document-processing";
import { requireMedtechAdmin } from "../../../../lib/member-auth";

type ParsedQuestion = { year: string; number: string; stem: string; options: Record<string, string>; answer: string; explanation: string };

function questionsFromProcessingResult(value: string): ParsedQuestion[] {
  try {
    const parsed = JSON.parse(value) as { questions?: Array<Record<string, unknown>> };
    return (parsed.questions ?? []).map((row, index) => ({
      year: clean(String(row.year ?? "模擬")),
      number: clean(String(row.number ?? index + 1)),
      stem: clean(String(row.title ?? "")),
      options: row.options && typeof row.options === "object" ? Object.fromEntries(Object.entries(row.options as Record<string, unknown>).map(([key, val]) => [key, clean(String(val ?? ""))])) : {},
      answer: clean(String(row.correct_answer ?? "")).replace(/[()（）\s]/gu, "").slice(0, 1).toUpperCase(),
      explanation: clean(String(row.explanation ?? row.teacher_answer ?? "")),
    })).filter((row) => row.stem && ["A", "B", "C", "D"].every((key) => row.options[key]));
  } catch { return []; }
}

function clean(value: string) { return value.replace(/\s+/gu, " ").trim(); }

function parseOptions(text: string) {
  const options: Record<string, string> = {};
  const matches = [...text.matchAll(/[（(]([A-D])[）)]\s*([\s\S]*?)(?=\s*[（(][A-D][）)]|$)/gu)];
  for (const match of matches) options[match[1]] = clean(match[2]);
  return options;
}

function parseQuestions(text: string): ParsedQuestion[] {
  // Word's automatic numbering is stored as a SEQ field.  The visible number
  // can therefore be glued to the field code instead of starting a paragraph
  // after DOCX extraction (for example: `SEQ 序 \\* ARABIC \\s +16. 題目`).
  // Normalize those fields before looking for numbered questions.
  const normalizedText = text.replace(
    /SEQ\s*序\s*\\\*\s*ARABIC(?:\s*\\[a-z]+\s*[+\-]?\d+)*\s*(\d{1,3}[.、])/giu,
    "\n$1",
  );
  const lines = normalizedText.split(/\r?\n/u).map(clean).filter(Boolean);
  const results: ParsedQuestion[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\d{1,3})[.、]\s*(.+)$/u);
    if (!start || !/[？?]|下列|何者|何種|最適|有關|關於/u.test(start[2])) continue;
    let optionStart = -1;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 12); cursor += 1) {
      if (/[（(]A[）)]/u.test(lines[cursor])) { optionStart = cursor; break; }
      if (/^\d{1,3}[.、]\s*\S/u.test(lines[cursor])) break;
    }
    if (optionStart < 0) continue;
    let answerIndex = -1;
    for (let cursor = optionStart; cursor < Math.min(lines.length, optionStart + 24); cursor += 1) {
      if (/^[^A-Za-z0-9]*[（(][A-D][）)]\s*$/u.test(lines[cursor])) { answerIndex = cursor; break; }
      if (cursor > index + 1 && /^\d{1,3}[.、]\s*\S/u.test(lines[cursor])) break;
    }
    if (answerIndex < 0) continue;
    const stem = clean([start[2], ...lines.slice(index + 1, optionStart)].join(" "));
    const optionText = lines.slice(optionStart, answerIndex).join(" ");
    const options = parseOptions(optionText);
    if (!["A", "B", "C", "D"].every((key) => options[key])) continue;
    const answer = lines[answerIndex].match(/[（(]([A-D])[）)]/u)?.[1] ?? "";
    let end = answerIndex + 1;
    const explanation: string[] = [];
    if (lines[end] === "【解析】") end += 1;
    while (end < lines.length && explanation.length < 12) {
      if (/^\d{1,3}[.、]\s*\S/u.test(lines[end]) || /^第\s*\d+\s*(?:章|節)/u.test(lines[end]) || /^=====/.test(lines[end])) break;
      explanation.push(lines[end]); end += 1;
    }
    const yearMatch = stem.match(/（(\d{2,3})[.．](?:2|7)月專技）/u);
    results.push({ year: yearMatch?.[1] ?? "模擬", number: start[1], stem, options, answer, explanation: clean(explanation.join(" ")) });
    index = answerIndex;
  }
  const unique = new Map<string, ParsedQuestion>();
  for (const question of results) unique.set(`${question.year}|${question.stem}`, question);
  return [...unique.values()];
}

export async function POST(request: Request) {
  try {
    const auth = await requireMedtechAdmin(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { documentId?: number; offset?: number; limit?: number };
    const documentId = Number(body.documentId);
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const limit = Math.min(150, Math.max(1, Math.floor(Number(body.limit) || 100)));
    const db = await getDb();
    const [document] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
    if (!document) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "找不到教材原始檔" }, { status: 404 });
    const indexedQuestions = questionsFromProcessingResult(document.processingResultJson);
    let localQuestions: ParsedQuestion[] = [];
    if (/\.pdf$/iu.test(document.fileName) || !indexedQuestions.length) {
      const inspected = await inspectDocumentBytes(document.fileName, await object.arrayBuffer());
      localQuestions = parseQuestions(inspected.text);
    }
    const questions = localQuestions.length > indexedQuestions.length ? localQuestions : indexedQuestions;
    if (!questions.length) return Response.json({ error: "未拆出選項與答案完整的題目" }, { status: 422 });
    if (offset === 0) await db.delete(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject), eq(examQuestions.sourceUrl, `document:${document.id}`)));
    // D1 limits the number of bound values in one statement. Each question
    // has many columns, so keep batches comfortably below that limit.
    let imported = 0;
    const failures: Array<{ number: string; stem: string }> = [];
    for (const question of questions.slice(offset, offset + limit)) {
      try {
        await db.insert(examQuestions).values({
        examCategory: "medtech",
        examType: "mcq",
        year: question.year,
        examName: "醫事檢驗師專技高考",
        subject: document.subject,
        questionNumber: question.number,
        stem: question.stem,
        optionsJson: JSON.stringify(question.options),
        correctAnswer: question.answer,
        explanation: question.explanation,
        answerSource: "教材原稿",
        answerStatus: "source_matched",
        sourceUrl: `document:${document.id}`,
          status: "draft",
        });
        imported += 1;
      } catch {
        failures.push({ number: question.number, stem: question.stem.slice(0, 120) });
      }
    }
    const nextOffset = Math.min(questions.length, offset + limit);
    if (nextOffset >= questions.length) {
      await db.update(documents).set({ questionCount: questions.length, processingMessage: `已完整拆出 ${questions.length} 題，可進入文件工作區逐題核對` }).where(eq(documents.id, documentId));
    }
    return Response.json({ imported, parsed: questions.length, offset, nextOffset, done: nextOffset >= questions.length, failed: failures.length, failures: failures.slice(0, 20), status: "draft", documentId, subject: document.subject });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "醫檢題庫匯入失敗" }, { status: 500 });
  }
}
