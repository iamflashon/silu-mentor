import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import { inspectDocumentBytes } from "../../../../lib/document-processing";
import { storedDocumentAnalysis } from "../../../../lib/document-analysis";
import { requireMedtechAdmin } from "../../../../lib/member-auth";

type ParsedQuestion = { year: string; number: string; stem: string; options: Record<string, string>; answer: string; explanation: string };

function answerLetter(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  const marked = text.match(/[（(]\s*([A-D])\s*[）)]/u);
  if (marked?.[1]) return marked[1];
  const plain = text.match(/(?:^|[\s:：.、])([A-D])(?=$|[\s])/u);
  return plain?.[1] || "";
}

function questionsFromProcessingResult(value: string): ParsedQuestion[] {
  // A malformed/legacy result can contain an entire HTML export. Refuse to
  // parse an unbounded blob inside the Worker; the caller can explicitly run
  // a fresh rebuild instead of taking down the request with an OOM.
  if (value.length > 5_000_000) return [];
  // Processed documents have existed in several result shapes over time
  // (root.questions, analysis.questions, result.questions, and facts
  // questionCandidates). Read all of them so opening an old document can
  // materialise its saved index without parsing the original PDF again.
  let reparsedRows: unknown[] = [];
  try {
    const root = JSON.parse(value) as Record<string, unknown>;
    reparsedRows = Array.isArray(root.reparsedQuestions) ? root.reparsedQuestions : [];
  } catch { /* fall through to the saved analysis */ }
  const parsed = storedDocumentAnalysis(value);
  const rows = reparsedRows.length ? reparsedRows : Array.isArray(parsed.questions) ? parsed.questions : [];
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
      answer: answerLetter(firstText(row, ["correct_answer", "correctAnswer", "answer", "teacher_answer", "teacherAnswer"])),
      explanation: firstText(row, ["explanation", "teacher_answer", "teacherAnswer"]),
    };
  }).filter((row) => row.stem && ["A", "B", "C", "D"].every((key) => row.options[key]));
}

function questionCandidatesFromProcessingResult(value: string): ParsedQuestion[] {
  if (value.length > 5_000_000) return [];
  const parsed = storedDocumentAnalysis(value);
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  const field = (row: Record<string, unknown>, keys: string[], fallback = "") => {
    for (const key of keys) {
      const text = clean(String(row[key] ?? ""));
      if (text) return text;
    }
    return fallback;
  };
  return rows.map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const rawOptions = row.options ?? row.choices ?? row.answers;
    const options = rawOptions && typeof rawOptions === "object"
      ? Object.fromEntries(Object.entries(rawOptions as Record<string, unknown>).map(([key, val]) => [key.replace(/[選項答案]/gu, "").toUpperCase(), clean(String(val ?? ""))]))
      : {};
    return {
      year: field(row, ["year", "exam_year"], "模擬"),
      number: field(row, ["number", "question_number", "questionNumber"], String(index + 1)),
      stem: field(row, ["title", "stem", "question", "content", "text"]),
      options,
      answer: answerLetter(field(row, ["correct_answer", "correctAnswer", "answer", "teacher_answer", "teacherAnswer"])),
      explanation: field(row, ["explanation", "teacher_answer", "teacherAnswer"]),
    };
  }).filter((row) => row.stem);
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

function parseAnswerKeyEntries(text: string) {
  const entries: Array<{ number: string; answer: string }> = [];
  let pendingNumberCount = 0;
  for (const line of text.split(/\r?\n/u).map(clean)) {
    if (!line) continue;
    const matches = [...line.matchAll(/(?:^|[\s,，;；])([0-9]{1,3})\s*[.、:：]?\s*[（(]?\s*([A-D])\s*[）)]?(?=$|[\s,，;；])/gu)];
    // Answer pages may be printed as `1. A 2. C …`, or one answer per line.
    // Require an answer-shaped line so question text and option labels are
    // not mistaken for the answer key.
    if (matches.length >= 2 || (matches.length === 1 && (line.length <= 14 || /答案|解答|正確/u.test(line)))) {
      for (const match of matches) entries.push({ number: match[1], answer: match[2] });
      pendingNumberCount = 0;
      continue;
    }
    // PDF table extraction can put the answer-key numbers and letters on
    // separate rows, for example:
    //   1  2  3  4  5 ...
    //   B  D  A  C  B ...
    // Keep that layout as an ordered answer block as well.
    const tokens = line.replace(/[.、:：（）()［］\[\],，;；]/gu, " ").split(/\s+/u).filter(Boolean);
    const numberTokens = tokens.filter((token) => /^\d{1,3}$/u.test(token));
    const letterTokens = tokens.filter((token) => /^[A-D]$/u.test(token.toUpperCase()));
    if (tokens.length >= 4 && numberTokens.length === tokens.length) {
      pendingNumberCount = numberTokens.length;
      continue;
    }
    if (pendingNumberCount >= 4 && tokens.length >= 4 && letterTokens.length === tokens.length) {
      const base = entries.length;
      for (const [index, token] of letterTokens.entries()) {
        entries.push({ number: String(base + index + 1), answer: token.toUpperCase() });
      }
      pendingNumberCount = 0;
    }
  }
  return entries;
}

function isAnswerKeyLine(line: string) {
  return /^\d{1,3}\s*[.、:：]?\s*[（(]\s*[A-D]\s*[）)]\s*$/u.test(line);
}

function parseQuestions(text: string): ParsedQuestion[] {
  // Word's automatic numbering is stored as a SEQ field.  The visible number
  // can therefore be glued to the field code instead of starting a paragraph
  // after DOCX extraction (for example: `SEQ 序 \\* ARABIC \\s +16. 題目`).
  // Normalize those fields before looking for numbered questions.
  const normalizedText = text.replace(/\f/g, "\n").replace(
    /SEQ\s*序\s*\\\*\s*ARABIC(?:\s*\\[a-z]+\s*[+\-]?\d+)*\s*(\d{1,3}[.、])/giu,
    "\n$1",
  // Do not mistake dates such as `109.2月專技` or decimal values for
  // question numbers. A question-number punctuation mark must be followed
  // by whitespace, an option marker, or the end of a line.
  ).replace(/(?<!\d)(\d{1,3})[.、](?=\s|[（(]|$)/gu, "\n$1. ").replace(/\s*([（(][A-D][）)])/gu, "\n$1 ");
  const answerKeyEntries = parseAnswerKeyEntries(normalizedText);
  const answerKeyByNumber = new Map<string, string>();
  for (const entry of answerKeyEntries) answerKeyByNumber.set(entry.number, entry.answer);
  const lines = normalizedText.split(/\r?\n/u).map(clean).filter(Boolean);
  const results: ParsedQuestion[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\d{1,3})[.、]\s*(.+)$/u);
    if (!start) continue;
    let optionStart = -1;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 36); cursor += 1) {
      if (/[（(]A[）)]/u.test(lines[cursor])) { optionStart = cursor; break; }
      if (/^\d{1,3}[.、]\s*\S/u.test(lines[cursor])) break;
    }
    if (optionStart < 0) continue;
    let answerIndex = -1;
    for (let cursor = optionStart; cursor < Math.min(lines.length, optionStart + 36); cursor += 1) {
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
    const answer = answerIndex >= 0 ? answerLetter(lines[answerIndex]) : "";
    let end = answerIndex >= 0 ? answerIndex + 1 : endOfOptions;
    const explanation: string[] = [];
    if (answerIndex >= 0 && lines[end] === "【解析】") end += 1;
    while (end < lines.length && explanation.length < 12) {
      if (/^\d{1,3}[.、]\s*\S/u.test(lines[end]) || isAnswerKeyLine(lines[end]) || /^第\s*\d+\s*(?:章|節)/u.test(lines[end]) || /^=====/.test(lines[end])) break;
      explanation.push(lines[end]); end += 1;
    }
    const yearMatch = stem.match(/（(\d{2,3})[.．](?:2|7)月專技）/u);
    results.push({ year: yearMatch?.[1] ?? "模擬", number: start[1], stem, options, answer: answer || answerKeyByNumber.get(start[1]) || "", explanation: clean(explanation.join(" ")) });
    index = answerIndex >= 0 ? answerIndex : Math.max(index, endOfOptions - 1);
  }
  const unique = new Map<string, ParsedQuestion>();
  for (const question of results) unique.set(`${question.year}|${question.stem}`, question);
  const questions = [...unique.values()];
  // Some full simulations repeat the answer numbering after every 40
  // questions. In that layout a number-only map would keep only the last
  // block, so use the answer-page order to fill the remaining questions.
  if (answerKeyEntries.length >= questions.length) {
    questions.forEach((question, index) => {
      if (!question.answer) question.answer = answerKeyEntries[index]?.answer || "";
    });
  }
  return questions;
}

export async function POST(request: Request) {
  try {
    const auth = await requireMedtechAdmin(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { documentId?: number; offset?: number; limit?: number; materializeOnly?: boolean; forceReparse?: boolean; repairMissing?: boolean };
    const documentId = Number(body.documentId);
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const limit = Math.min(body.materializeOnly ? 25 : 150, Math.max(1, Math.floor(Number(body.limit) || 100)));
    const db = await getDb();
    const [document] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
    if (!document) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
    // A previous import may have materialised the questions under a legacy
    // filename/storage source. Recover that set before touching R2 or parsing
    // the PDF; this is the important fast path for old documents whose card
    // already reports a question count but whose workspace is empty.
    const expected = Number(document.questionCount ?? 0);
    if (expected > 0) {
      const existingRows = await db.select({ sourceUrl: examQuestions.sourceUrl })
        .from(examQuestions)
        .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject)))
        .limit(1600);
      const counts = new Map<string, number>();
      for (const row of existingRows) counts.set(row.sourceUrl, (counts.get(row.sourceUrl) ?? 0) + 1);
      const aliases = new Set([`document:${document.id}`, document.storageKey, document.fileName]);
      const ranked = [...counts.entries()].sort((left, right) => {
        const leftDistance = Math.abs(left[1] - expected);
        const rightDistance = Math.abs(right[1] - expected);
        return leftDistance - rightDistance;
      });
      const recovered = ranked.find(([source, count]) =>
        (aliases.has(source) || source.includes(String(document.id)) || source.includes(document.fileName))
        && Math.abs(count - expected) <= 2,
      )
        ?? ranked.find(([, count]) => Math.abs(count - expected) <= 2);
      if (recovered && !body.forceReparse && !body.repairMissing) {
        await db.update(documents).set({ processingMessage: `已回復既有 ${recovered[1]} 題索引；原稿未重新拆解` }).where(eq(documents.id, documentId));
        return Response.json({ imported: 0, parsed: recovered[1], offset, nextOffset: recovered[1], done: true, failed: 0, failures: [], recovered: true, status: "draft", documentId, subject: document.subject });
      }
    }
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "找不到教材原始檔" }, { status: 404 });
    const indexedQuestions = body.forceReparse || body.repairMissing ? [] : questionsFromProcessingResult(document.processingResultJson);
    const savedCandidates = indexedQuestions.length && indexedQuestions.length >= expected
      ? []
      : questionCandidatesFromProcessingResult(document.processingResultJson);
    let localQuestions: ParsedQuestion[] = [];
    // When the normal document processor already stored the parsed questions,
    // materialising them into editable rows must not re-read the PDF.
    // If the document is already marked as processed, do not fall back to
    // PDF.js in this request. A large PDF can exceed the Worker memory limit;
    // an explicit retry/rebuild is the only path that should re-read it.
    // If the stored index has no full A-D records, recover from the original
    // PDF/HTML even when questionCount is stale. Materialisation is paged to
    // stay under D1's bound-parameter limit, so each continuation request
    // needs the same parsed source list before inserting its next slice.
    const storedCount = Math.max(indexedQuestions.length, savedCandidates.length);
    const shouldReparseOriginal = Boolean(body.forceReparse || body.repairMissing) || (!indexedQuestions.length && !savedCandidates.length) || (Boolean(body.materializeOnly) && expected > 0 && storedCount < expected);
    if (shouldReparseOriginal) {
      const inspected = await inspectDocumentBytes(document.fileName, await object.arrayBuffer());
      localQuestions = parseQuestions(inspected.text);
    }
    const questionQuality = (rows: ParsedQuestion[]) => rows.reduce((score, row) => score + ( ["A", "B", "C", "D"].every(key => row.options[key]) ? 1000000 : 1 ), 0);
    const questions = [localQuestions, indexedQuestions, savedCandidates].sort((left, right) => questionQuality(right) - questionQuality(left) || right.length - left.length)[0] ?? [];
    if (!questions.length) return Response.json({ error: "未拆出選項與答案完整的題目" }, { status: 422 });
    if (offset === 0 && shouldReparseOriginal && localQuestions.length) {
      let stored: Record<string, unknown> = {};
      try { stored = JSON.parse(document.processingResultJson || "{}") as Record<string, unknown>; } catch { /* replace malformed legacy JSON */ }
      await db.update(documents).set({ processingResultJson: JSON.stringify({ ...stored, reparsedQuestions: localQuestions }) }).where(eq(documents.id, documentId));
    }
    if (body.repairMissing) {
      if (!localQuestions.length) return Response.json({ error: "原稿未能拆出可補齊的題目，未變更既有題庫" }, { status: 422 });
      const aliases = [...new Set([`document:${document.id}`, document.storageKey, document.fileName])];
      const existing = await db.select().from(examQuestions)
        .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject), inArray(examQuestions.sourceUrl, aliases)))
        .orderBy(asc(examQuestions.id))
        .limit(1600);
      const normalizeStem = (value: string) => String(value ?? "")
        .replace(/<[^>]+>/gu, " ")
        .replace(/&nbsp;|\s+/giu, "")
        .replace(/[：:，,。？！?!、；;（）()【】\[\]「」『』]/gu, "")
        .toLocaleLowerCase();
      const parsedByStem = new Map(localQuestions.map((question, index) => [normalizeStem(question.stem), { question, index }]));
      const parsedByNumber = new Map<string, number[]>();
      localQuestions.forEach((question, index) => {
        const key = String(question.number).trim();
        parsedByNumber.set(key, [...(parsedByNumber.get(key) ?? []), index]);
      });
      const used = new Set<number>();
      let updated = 0;
      let answersUpdated = 0;
      for (const row of existing) {
        let match = parsedByStem.get(normalizeStem(row.stem));
        if (!match) {
          const fallbackIndex = (parsedByNumber.get(String(row.questionNumber).trim()) ?? []).find((index) => !used.has(index));
          if (fallbackIndex !== undefined) match = { question: localQuestions[fallbackIndex], index: fallbackIndex };
        }
        if (!match || used.has(match.index)) continue;
        used.add(match.index);
        if (row.sourceOrder !== match.index + 1) {
          await db.update(examQuestions).set({ sourceOrder: match.index + 1 }).where(eq(examQuestions.id, row.id));
          updated += 1;
        }
        const parsedAnswer = answerLetter(match.question.answer);
        const existingTeacherAnswer = answerLetter(row.teacherAnswer);
        const existingCorrectAnswer = answerLetter(row.correctAnswer);
        if (parsedAnswer && !existingTeacherAnswer && !existingCorrectAnswer) {
          await db.update(examQuestions).set({
            teacherAnswer: parsedAnswer,
            correctAnswer: parsedAnswer,
            answerSource: document.bookTitle || "原稿答案",
            answerStatus: "source_matched",
          }).where(eq(examQuestions.id, row.id));
          answersUpdated += 1;
        }
      }
      const missing = localQuestions
        .map((question, index) => ({ question, index }))
        .filter(({ index }) => !used.has(index));
      let imported = 0;
      for (const { question, index } of missing) {
        await db.insert(examQuestions).values({
          examCategory: "medtech",
          examType: "mcq",
          year: question.year,
          examName: "醫事檢驗師專技高考",
          subject: document.subject,
          questionNumber: question.number,
          stem: question.stem,
          optionsJson: JSON.stringify(question.options),
          correctAnswer: question.answer || null,
          explanation: question.explanation,
          teacherAnswer: question.answer,
          answerSource: document.bookTitle || (question.answer ? "原稿答案" : "待補答案"),
          answerStatus: question.answer ? "source_matched" : "missing",
          sourceUrl: `document:${document.id}`,
          sourceOrder: index + 1,
          status: "draft",
        });
        imported += 1;
      }
      const finalCount = Math.max(Number(document.questionCount ?? 0), existing.length + imported, localQuestions.length);
      await db.update(documents).set({ questionCount: finalCount, processingMessage: `已依原稿比對缺題：目前 ${finalCount} 題；新增 ${imported} 題` }).where(eq(documents.id, documentId));
      return Response.json({ repaired: true, imported, updated, answersUpdated, parsed: finalCount, sourceParsed: localQuestions.length, missing: missing.map(({ question, index }) => ({ sourceOrder: index + 1, number: question.number, stem: question.stem.slice(0, 160), answer: question.answer })), done: true, documentId, subject: document.subject, status: "draft" });
    }
    if (offset === 0 && !body.materializeOnly) await db.delete(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject), eq(examQuestions.sourceUrl, `document:${document.id}`)));
    // D1 limits the number of bound values in one statement. Each question
    // has many columns, so keep batches comfortably below that limit.
    const existingKeys = new Set<string>();
    if (body.materializeOnly && offset === 0) {
      const aliases = [document.storageKey, document.fileName, `document:${document.id}`];
      const existing = await db.select({ questionNumber: examQuestions.questionNumber, stem: examQuestions.stem })
        .from(examQuestions)
        .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject), inArray(examQuestions.sourceUrl, aliases)))
        .limit(1600);
      for (const row of existing) existingKeys.add(`${row.questionNumber}|${row.stem}`);
    }
    let imported = 0;
    const failures: Array<{ number: string; stem: string }> = [];
    for (const [index, question] of questions.slice(offset, offset + limit).entries()) {
      try {
        const key = `${question.number}|${question.stem}`;
        if (body.materializeOnly && existingKeys.has(key)) continue;
        await db.insert(examQuestions).values({
        examCategory: "medtech",
        examType: "mcq",
        year: question.year,
        examName: "醫事檢驗師專技高考",
        subject: document.subject,
        questionNumber: question.number,
        stem: question.stem,
        optionsJson: JSON.stringify(question.options),
        correctAnswer: question.answer || null,
        explanation: question.explanation,
        teacherAnswer: question.answer,
        answerSource: document.bookTitle || (question.answer ? "原稿答案" : "待補答案"),
        answerStatus: question.answer ? "source_matched" : "missing",
        sourceUrl: `document:${document.id}`,
          sourceOrder: offset + index + 1,
          status: "draft",
        });
        existingKeys.add(key);
        imported += 1;
      } catch {
        failures.push({ number: question.number, stem: question.stem.slice(0, 120) });
      }
    }
    const nextOffset = Math.min(questions.length, offset + limit);
    if (nextOffset >= questions.length) {
      await db.update(documents).set({ questionCount: questions.length, processingMessage: savedCandidates.length && !indexedQuestions.length ? `已從保存的文件索引載入 ${questions.length} 題；請在工作區核對選項與答案` : `已完整拆出 ${questions.length} 題，可進入文件工作區逐題核對` }).where(eq(documents.id, documentId));
    }
    return Response.json({ imported, parsed: questions.length, offset, nextOffset, done: nextOffset >= questions.length, failed: failures.length, failures: failures.slice(0, 20), partial: Boolean(savedCandidates.length && !indexedQuestions.length), status: "draft", documentId, subject: document.subject });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "醫檢題庫匯入失敗" }, { status: 500 });
  }
}
