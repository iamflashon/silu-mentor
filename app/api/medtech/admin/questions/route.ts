import { and, asc, desc, eq, isNotNull, like, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const requestedId = Number(url.searchParams.get("id"));
  if (Number.isInteger(requestedId) && requestedId > 0) {
    const db = await getDb();
    const [item] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, requestedId), eq(examQuestions.examCategory, "medtech"))).limit(1);
    if (!item) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
    const sourceId = Number(item.sourceUrl.replace(/^document:/, ""));
    const [source] = Number.isInteger(sourceId) && sourceId > 0
      ? await db.select({ fileName: documents.fileName, subject: documents.subject }).from(documents).where(and(eq(documents.id, sourceId), eq(documents.examCategory, "medtech"))).limit(1)
      : [];
    const sourceText = `${source?.fileName ?? ""} ${source?.subject ?? ""} ${item.sourceUrl} ${item.examName} ${item.subject}`;
    const topic = /全真模擬|模擬試題/i.test(sourceText)
      ? "全真模擬試題"
      : /DNA\s*病毒/i.test(sourceText)
        ? "DNA 病毒"
        : /RNA\s*病毒/i.test(sourceText)
          ? "RNA 病毒"
          : /臨床病毒學.*總論|總論.*臨床病毒學/i.test(sourceText)
            ? "臨床病毒學總論"
            : "其他";
    return Response.json({ item: {
      ...item,
      options: JSON.parse(item.optionsJson || "{}"),
      topic,
      isSimulation: topic === "全真模擬試題",
      aiAccuracy: item.simulatedAnswer && item.teacherAnswer ? (item.simulatedAnswer === item.teacherAnswer ? "correct" : "incorrect") : "pending",
    } });
  }
  const documentId = Number(url.searchParams.get("documentId"));
  const sourceOrder = url.searchParams.get("order") === "source";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit")) || 30));
  const query = url.searchParams.get("query")?.trim() ?? "";
  const year = url.searchParams.get("year")?.trim() ?? "";
  const subject = url.searchParams.get("subject")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const db = await getDb();
  const sourceDocuments = await db.select({ id: documents.id, fileName: documents.fileName, subject: documents.subject })
    .from(documents)
    .where(eq(documents.examCategory, "medtech"));
  const sourceById = new Map(sourceDocuments.map((document) => [document.id, document]));
  const sourceFor = (sourceUrl: string) => sourceById.get(Number(sourceUrl.replace(/^document:/, "")));
  const topicOf = (question: { sourceUrl: string; subject: string; examName: string }) => {
    const source = sourceFor(question.sourceUrl);
    const sourceText = `${source?.fileName ?? ""} ${source?.subject ?? ""} ${question.sourceUrl} ${question.examName} ${question.subject}`;
    if (/全真模擬|模擬試題/i.test(sourceText)) return "全真模擬試題";
    if (/DNA\s*病毒/i.test(sourceText)) return "DNA 病毒";
    if (/RNA\s*病毒/i.test(sourceText)) return "RNA 病毒";
    if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(sourceText)) return "臨床病毒學總論";
    return "其他";
  };
  let documentSources: string[] = [];
  if (Number.isInteger(documentId) && documentId > 0) {
    const [document] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
      .limit(1);
    documentSources = [...new Set([`document:${documentId}`, document?.storageKey, document?.fileName].filter((value): value is string => Boolean(value)))];
  }
  const baseFilters = [
    eq(examQuestions.examCategory, "medtech"),
    ...(query ? [or(like(examQuestions.stem, `%${query}%`), like(examQuestions.explanation, `%${query}%`), like(examQuestions.completeExplanation, `%${query}%`), like(examQuestions.simulatedExplanation, `%${query}%`), like(examQuestions.simulatedCompleteExplanation, `%${query}%`), like(examQuestions.questionNumber, `%${query}%`))!] : []),
    ...(year ? [eq(examQuestions.year, year)] : []),
    ...(subject ? [eq(examQuestions.subject, subject)] : []),
    ...(status ? [eq(examQuestions.status, status)] : []),
  ];
  const sourceFilter = documentSources.length ? or(...documentSources.map(source => eq(examQuestions.sourceUrl, source))) : null;
  let where = and(...baseFilters, ...(sourceFilter ? [sourceFilter] : []));
  let [countRow] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(where);

  // Older imports used the uploaded filename (or a generated storage key) as
  // sourceUrl instead of `document:<id>`. If the exact aliases miss, recover
  // the one unambiguous source group for this document's subject. This keeps
  // an existing question set editable without reading/parsing the original
  // PDF again, and avoids mixing subjects when several documents exist.
  if (Number.isInteger(documentId) && documentId > 0 && documentSources.length && Number(countRow?.total ?? 0) === 0 && !subject) {
    const [document] = await db.select({ subject: documents.subject, questionCount: documents.questionCount, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
      .limit(1);
    if (document?.subject) {
      const subjectRows = await db.select({ sourceUrl: examQuestions.sourceUrl })
        .from(examQuestions)
        .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject)))
        .limit(1200);
      const counts = new Map<string, number>();
      for (const row of subjectRows) counts.set(row.sourceUrl, (counts.get(row.sourceUrl) ?? 0) + 1);
      const expected = Number(document.questionCount ?? 0);
      const ranked = [...counts.entries()].sort((left, right) => {
        const leftDistance = expected > 0 ? Math.abs(left[1] - expected) : 0;
        const rightDistance = expected > 0 ? Math.abs(right[1] - expected) : 0;
        return expected > 0 ? leftDistance - rightDistance : right[1] - left[1];
      });
      const exact = ranked.find(([source, count]) =>
        (documentSources.includes(source) || source.includes(String(documentId)) || source.includes(document.fileName))
        && (expected <= 0 || Math.abs(count - expected) <= 2),
      );
      const recovered = exact
        ?? ranked.find(([, count]) => expected > 0 && Math.abs(count - expected) <= 2)
        ?? (expected <= 0 && ranked.length === 1 ? ranked[0] : null);
      if (recovered) {
        where = and(...baseFilters, eq(examQuestions.sourceUrl, recovered[0]));
        [countRow] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(where);
      }
    }
  }
  const [draftRow] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(and(
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
    eq(examQuestions.status, "draft"),
  ));
  const items = await db.select().from(examQuestions).where(where).orderBy(sourceOrder && Number.isInteger(documentId) && documentId > 0 ? asc(examQuestions.sourceOrder) : desc(examQuestions.id)).limit(limit).offset((page - 1) * limit);
  const facets = await db.select({ year: examQuestions.year, subject: examQuestions.subject }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech"));
  return Response.json({
    items: items.map(item => {
      const topic = topicOf(item);
      return {
        ...item,
        options: JSON.parse(item.optionsJson || "{}"),
        topic,
        isSimulation: topic === "全真模擬試題",
        aiAccuracy: item.simulatedAnswer && item.teacherAnswer
          ? (item.simulatedAnswer === item.teacherAnswer ? "correct" : "incorrect")
          : "pending",
      };
    }),
    total: Number(countRow?.total ?? 0), draftTotal: Number(draftRow?.total ?? 0), page, limit,
    years: [...new Set(facets.map(item => item.year).filter(Boolean))].sort((a,b)=>b.localeCompare(a,"zh-Hant",{numeric:true})),
    subjects: [...new Set(facets.map(item => item.subject).filter(Boolean))].sort(),
  });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as Record<string, unknown>;
  const documentId = Number(body.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "缺少文件編號" }, { status: 400 });
  const questionNumber = String(body.questionNumber ?? "").trim();
  const stem = String(body.stem ?? "").trim();
  const optionValues = body.options && typeof body.options === "object" ? body.options as Record<string, unknown> : {};
  const options = Object.fromEntries(["A", "B", "C", "D"].map((key) => [key, sanitizeRichHtml(String(optionValues[key] ?? "").trim())]));
  if (!questionNumber) return Response.json({ error: "請先填寫題號" }, { status: 400 });
  const hasAnyContent = Boolean(stem || Object.values(options).some((value) => value));
  if (hasAnyContent && (!stem || Object.values(options).some((value) => !value))) return Response.json({ error: "若已開始填內容，請補齊題幹與 A～D 四個選項；或先建立空白草稿" }, { status: 400 });
  const answer = String(body.answer ?? "").trim().toUpperCase();
  if (answer && !/^[A-D]$/.test(answer)) return Response.json({ error: "答案只能是 A、B、C 或 D" }, { status: 400 });
  const sourceOrderValue = Number(body.sourceOrder);
  const sourceOrder = Number.isInteger(sourceOrderValue) && sourceOrderValue > 0 ? sourceOrderValue : null;
  const db = await getDb();
  const [document] = await db.select({ id: documents.id, subject: documents.subject, bookTitle: documents.bookTitle, fileName: documents.fileName })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
    .limit(1);
  if (!document) return Response.json({ error: "找不到指定的醫檢文件" }, { status: 404 });
  const sourceUrl = `document:${document.id}`;
  const [duplicate] = await db.select({ id: examQuestions.id })
    .from(examQuestions)
    .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, sourceUrl), eq(examQuestions.questionNumber, questionNumber), eq(examQuestions.stem, sanitizeRichHtml(stem))))
    .limit(1);
  if (duplicate) return Response.json({ error: "這題已存在，請改用編輯既有題目" }, { status: 409 });
  const [created] = await db.insert(examQuestions).values({
    examCategory: "medtech",
    examType: "mcq",
    year: String(body.year ?? "模擬").trim() || "模擬",
    examName: "醫事檢驗師專技高考",
    subject: document.subject,
    questionNumber,
    stem: sanitizeRichHtml(stem),
    optionsJson: JSON.stringify(options),
    correctAnswer: answer || null,
    teacherAnswer: answer,
    explanation: sanitizeRichHtml(String(body.explanation ?? "").trim()),
    answerSource: document.bookTitle || (answer ? "待補來源" : "待補答案"),
    answerStatus: answer ? "teacher_confirmed" : "missing",
    sourceUrl,
    sourceOrder,
    status: "draft",
  }).returning();
  const nextCount = await db.select({ total: sql<number>`count(*)` }).from(examQuestions)
    .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, sourceUrl)));
  await db.update(documents).set({ questionCount: Number(nextCount[0]?.total ?? 0), processingMessage: `已手動新增題目，目前共 ${Number(nextCount[0]?.total ?? 0)} 題` }).where(eq(documents.id, document.id));
  return Response.json({ item: { ...created, options }, created: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as Record<string, unknown>;
  const replaceFind = typeof body.replaceFind === "string" ? body.replaceFind : "";
  if (replaceFind) {
    const documentId = Number(body.documentId);
    const replacement = typeof body.replaceWith === "string" ? body.replaceWith : "";
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "缺少文件編號" }, { status: 400 });
    if (replaceFind.length > 2000 || replacement.length > 4000) return Response.json({ error: "搜尋或取代文字過長" }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
      .limit(1);
    const sources = [...new Set([`document:${documentId}`, document?.storageKey, document?.fileName].filter((value): value is string => Boolean(value)))];
    const rows = await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), or(...sources.map(source => eq(examQuestions.sourceUrl, source)))));
    let matched = 0;
    for (const row of rows) {
      const options = JSON.parse(row.optionsJson || "{}") as Record<string, string>;
      const replace = (value: string) => value.split(replaceFind).join(replacement);
      const nextStem = replace(row.stem);
      const nextExplanation = replace(row.explanation);
      const nextCompleteExplanation = replace(row.completeExplanation);
      const nextOptions = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, replace(String(value ?? ""))]));
      const changed = nextStem !== row.stem || nextExplanation !== row.explanation || nextCompleteExplanation !== row.completeExplanation || JSON.stringify(nextOptions) !== JSON.stringify(options);
      if (!changed) continue;
      matched += 1;
      await db.update(examQuestions).set({ stem: sanitizeRichHtml(nextStem), explanation: sanitizeRichHtml(nextExplanation), completeExplanation: sanitizeRichHtml(nextCompleteExplanation), optionsJson: JSON.stringify(Object.fromEntries(Object.entries(nextOptions).map(([key, value]) => [key, sanitizeRichHtml(value)]))) }).where(eq(examQuestions.id, row.id));
    }
    return Response.json({ replaced: true, matched, updated: matched, find: replaceFind, replaceWith: replacement });
  }
  const id = Number(body.id);
  const db = await getDb();
  if (body.publishAllDrafts === true) {
    const [draftCount] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.examType, "mcq"),
      eq(examQuestions.status, "draft"),
    ));
    const rows = await db.update(examQuestions).set({ status: "published" }).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.examType, "mcq"),
      eq(examQuestions.status, "draft"),
      or(
        and(isNotNull(examQuestions.teacherAnswer), ne(examQuestions.teacherAnswer, "")),
        and(isNotNull(examQuestions.correctAnswer), ne(examQuestions.correctAnswer, "")),
        and(eq(examQuestions.examName, "全真模擬試題"), isNotNull(examQuestions.simulatedAnswer), ne(examQuestions.simulatedAnswer, "")),
      ),
    )).returning({ id: examQuestions.id });
    return Response.json({ updated: rows.length, skippedUnanswered: Math.max(0, Number(draftCount?.total ?? 0) - rows.length), status: "published" });
  }
  const [existing] = await db.select({ id: examQuestions.id }).from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech"))).limit(1);
  if (!existing) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
  const allowed = ["year","subject","questionNumber","stem","correctAnswer","teacherAnswer","explanation","completeExplanation","aiCompleteExplanation","teacherCompleteExplanation","voiceScript","answerSource","answerStatus","simulatedAnswer","simulatedExplanation","simulatedCompleteExplanation","simulatedSource","simulatedAnswerStatus","simulatedTeacherNote","status"] as const;
  const values: Record<string,string | null> = {};
  for (const key of allowed) if (typeof body[key] === "string") values[key] = ["stem","explanation","completeExplanation","aiCompleteExplanation","teacherCompleteExplanation","voiceScript","simulatedExplanation","simulatedCompleteExplanation"].includes(key) ? sanitizeRichHtml(String(body[key]).trim()) : String(body[key]).trim();
  const hasTeacherAnswer = typeof body.teacherAnswer === "string";
  const teacherAnswer = hasTeacherAnswer ? String(body.teacherAnswer).trim().toUpperCase() : (typeof body.correctAnswer === "string" ? body.correctAnswer.trim().toUpperCase() : "");
  const simulatedAnswer = typeof body.simulatedAnswer === "string" ? body.simulatedAnswer.trim().toUpperCase() : "";
  if (typeof body.teacherCompleteExplanation === "string") {
    const teacherCompleteExplanation = sanitizeRichHtml(String(body.teacherCompleteExplanation).trim());
    values.teacherCompleteExplanation = teacherCompleteExplanation;
    // Keep the legacy export/audio field synchronized with the teacher-confirmed version.
    values.completeExplanation = teacherCompleteExplanation;
  }
  if (hasTeacherAnswer || typeof body.correctAnswer === "string") {
    values.teacherAnswer = teacherAnswer;
    values.correctAnswer = teacherAnswer || null;
  }
  if (/^[A-D]$/.test(teacherAnswer) && /^[A-D]$/.test(simulatedAnswer)) {
    values.answerStatus = "teacher_confirmed";
    values.simulatedAnswerStatus = teacherAnswer === simulatedAnswer ? "ai_correct" : "ai_incorrect";
  }
  if (body.options && typeof body.options === "object") values.optionsJson = JSON.stringify(Object.fromEntries(Object.entries(body.options).map(([key,value])=>[key,sanitizeRichHtml(String(value))])));
  await db.update(examQuestions).set(values).where(eq(examQuestions.id, id));
  return Response.json({ updated: true });
}

export async function DELETE(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const { id } = await request.json() as { id?: number };
  const db = await getDb();
  await db.delete(examQuestions).where(and(eq(examQuestions.id, Number(id)), eq(examQuestions.examCategory, "medtech")));
  return Response.json({ deleted: true });
}
