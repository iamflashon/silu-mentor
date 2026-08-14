import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import { inspectDocumentBytes } from "../../../../lib/document-processing";
import { storedDocumentAnalysis } from "../../../../lib/document-analysis";
import { requireMedtechAdmin } from "../../../../lib/member-auth";

type ParsedQuestion = { year: string; number: string; stem: string; options: Record<string, string>; answer: string; explanation: string };

function questionsFromProcessingResult(value: string): ParsedQuestion[] {
  // A malformed/legacy result can contain an entire HTML export. Refuse to
  // parse an unbounded blob inside the Worker; the caller can explicitly run
  // a fresh rebuild instead of taking down the request with an OOM.
  if (value.length > 5_000_000) return [];
  // Processed documents have existed in several result shapes over time
  // (root.questions, analysis.questions, result.questions, and facts
  // questionCandidates). Read all of them so opening an old document can
  // materialise its saved index without parsing the original PDF again.
  const parsed = storedDocumentAnalysis(value);
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  const firstText = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const text = clean(String(row[key] ?? ""));
      if (text) return text;
    }
    return "";
  };
  return rows.map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const rawOptions = row.options ?? row.choices ?? row.answers;
    const options = rawOptions && typeof rawOptions === "object"
      ? Object.fromEntries(Object.entries(rawOptions as Record<string, unknown>).map(([key, val]) => [key.replace(/[選項答案]/gu, "").toUpperCase(), clean(String(val ?? ""))]))
      : {};
    return {
      year: clean(firstText(row, ["year", "exam_year"]) || "模擬"),
      number: clean(firstText(row, ["number", "question_number", "questionNumber"]) || String(index + 1)),
      stem: firstText(row, ["title", "stem", "question", "content", "text"]),
      options,
      answer: clean(firstText(row, ["correct_answer", "correctAnswer", "answer"])).replace(/[()（）\s]/gu, "").slice(0, 1).toUpperCase(),
      explanation: firstText(row, ["explanation", "teacher_answer", "teacherAnswer"]),
    };
  }).filter((row) => row.stem && ["A", "B", "C", "D"].every((key) => row.options[key]));
}

function clean(value: string) {
  return value.replace(/\s+/gu, " ").trim().replace(/(\d+(?:\.\d+)?)\s*(?:[oº°]\s*)?C(?=\s|冷|熱|保存|培養|$)/giu, "$1°C");
}

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
    // Some uploaded HTML/Word papers contain only the question and four
    // options. Do not discard those questions just because the answer key is
    // stored in another file; import them with an empty answer so the editor
    // can complete it later.
    const optionEnd = answerIndex >= 0 ? answerIndex : lines.findIndex((line, cursor) => cursor > optionStart && cursor > index && /^\d{1,3}[.、]\s*\S/u.test(line));
    const endOfOptions = optionEnd >= 0 ? optionEnd : lines.length;
    const stem = clean([start[2], ...lines.slice(index + 1, optionStart)].join(" "));
    const optionText = lines.slice(optionStart, endOfOptions).join(" ");
    const options = parseOptions(optionText);
    if (!["A", "B", "C", "D"].every((key) => options[key])) continue;
    const answer = answerIndex >= 0 ? lines[answerIndex].match(/[（(]([A-D])[）)]/u)?.[1] ?? "" : "";
    let end = answerIndex >= 0 ? answerIndex + 1 : endOfOptions;
    const explanation: string[] = [];
    if (answerIndex >= 0 && lines[end] === "【解析】") end += 1;
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
    const body = await request.json() as { documentId?: number; offset?: number; limit?: number; materializeOnly?: boolean };
    const documentId = Number(body.documentId);
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const limit = Math.min(body.materializeOnly ? 25 : 150, Math.max(1, Math.floor(Number(body.limit) || 100)));
    const db = await getDb();
    const [document] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
    if (!document) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
    // A previous processing run could have counted the detected questions in
    // `documents.questionCount` without ever materialising editable rows. In
    // that case the workspace opens with 0 questions and the materialise-only
    // request used to stop before reading the original file. Check for rows,
    // rather than trusting the cached count, so a stale index can be repaired
    // automatically without asking the administrator to upload the file again.
    const existingRows = await db.select({ id: examQuestions.id }).from(examQuestions).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.sourceUrl, `document:${document.id}`),
    )).limit(1);
    const hasMaterializedRows = existingRows.length > 0;
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "找不到教材原始檔" }, { status: 404 });
    const indexedQuestions = questionsFromProcessingResult(document.processingResultJson);
    let localQuestions: ParsedQuestion[] = [];
    // When the normal document processor already stored the parsed questions,
    // materialising them into editable rows must not re-read the PDF.
    // If the document is already marked as processed, do not fall back to
    // PDF.js in this request. A large PDF can exceed the Worker memory limit;
    // an explicit retry/rebuild is the only path that should re-read it.
    // If there are no saved editable rows, materialize-only is allowed to
    // recover from the original PDF/HTML even when questionCount is stale.
    // This is intentionally bounded by the normal upload limit and happens
    // only for a document with an empty row set; existing rows are never
    // re-parsed or replaced by opening the workspace.
    if (!indexedQuestions.length && (!body.materializeOnly || !hasMaterializedRows)) {
      const inspected = await inspectDocumentBytes(document.fileName, await object.arrayBuffer());
      localQuestions = parseQuestions(inspected.text);
    }
    const questions = localQuestions.length > indexedQuestions.length ? localQuestions : indexedQuestions;
    if (!questions.length) return Response.json({ error: "未拆出選項與答案完整的題目" }, { status: 422 });
    if (offset === 0 && !body.materializeOnly) await db.delete(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject), eq(examQuestions.sourceUrl, `document:${document.id}`)));
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
        answerSource: question.answer ? "教材原稿" : "待補答案",
        answerStatus: question.answer ? "source_matched" : "missing",
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
