import { and, desc, eq, gte, inArray, isNotNull, like, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions, listeningAudioSegments, listeningSolutions, listeningSubtitleCues } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";

async function shiftSourceOrders(db: Awaited<ReturnType<typeof getDb>>, sourceUrl: string, minimumOrder: number, exceptId?: number) {
  const rows = await db.select({ id: examQuestions.id, sourceOrder: examQuestions.sourceOrder })
    .from(examQuestions)
    .where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.sourceUrl, sourceUrl),
      isNotNull(examQuestions.sourceOrder),
      gte(examQuestions.sourceOrder, minimumOrder),
      ...(exceptId ? [ne(examQuestions.id, exceptId)] : []),
    ))
    .orderBy(desc(examQuestions.sourceOrder));
  for (const row of rows) {
    const nextOrder = Number(row.sourceOrder) + 1;
    await db.update(examQuestions).set({ sourceOrder: nextOrder }).where(eq(examQuestions.id, row.id));
  }
}

async function repairDuplicateSourceOrders(db: Awaited<ReturnType<typeof getDb>>, sourceUrl: string) {
  let repaired = 0;
  for (let pass = 0; pass < 120; pass += 1) {
    const rows = await db.select({ id: examQuestions.id, sourceOrder: examQuestions.sourceOrder, questionNumber: examQuestions.questionNumber })
      .from(examQuestions)
      .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, sourceUrl), isNotNull(examQuestions.sourceOrder)))
      .orderBy(examQuestions.sourceOrder, examQuestions.id);
    const groups = new Map<number, typeof rows>();
    for (const row of rows) {
      const order = Number(row.sourceOrder);
      const group = groups.get(order) ?? [];
      group.push(row);
      groups.set(order, group);
    }
    const duplicate = [...groups.entries()].find(([, group]) => group.length > 1);
    if (!duplicate) break;
    const [order, group] = duplicate;
    const keeper = group.find((row) => Number(row.questionNumber) === order) ?? group[0];
    await shiftSourceOrders(db, sourceUrl, order, keeper.id);
    repaired += group.length - 1;
  }
  return repaired;
}

function hasReviewableExplanation(question: { explanation?: string | null; aiCompleteExplanation?: string | null; simulatedCompleteExplanation?: string | null; teacherCompleteExplanation?: string | null; completeExplanation?: string | null }) {
  return [question.teacherCompleteExplanation, question.completeExplanation, question.aiCompleteExplanation, question.simulatedCompleteExplanation, question.explanation]
    .some((value) => String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length >= 15);
}

function hasTeacherAnswer(question: { teacherAnswer?: string | null; correctAnswer?: string | null }) {
  return /^[A-D]$/i.test(String(question.teacherAnswer || question.correctAnswer || "").trim());
}

function hasPublishableAnswer(question: { teacherAnswer?: string | null; correctAnswer?: string | null; reviewStatus?: string | null; examName?: string | null; subject?: string | null; simulatedAnswer?: string | null }) {
  // A teacher answer is already an explicit answer confirmation. For full
  // simulation questions, a reviewed AI answer is also publishable even when
  // the teacher-answer field is intentionally left blank.
  if (hasTeacherAnswer(question)) return true;
  const sourceText = `${question.examName ?? ""} ${question.subject ?? ""}`;
  return question.reviewStatus === "confirmed"
    && /全真模擬|模擬試題/u.test(sourceText)
    && /^[A-D]$/i.test(String(question.simulatedAnswer ?? "").trim());
}

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
      isSimulation: item.examType === "mcq",
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
  const items = await db.select().from(examQuestions).where(where).orderBy(sourceOrder && Number.isInteger(documentId) && documentId > 0
    ? sql`CASE WHEN ${examQuestions.sourceOrder} IS NULL THEN 1 ELSE 0 END, ${examQuestions.sourceOrder} ASC, ${examQuestions.id} ASC`
    : desc(examQuestions.id)).limit(limit).offset((page - 1) * limit);
  const facets = await db.select({ year: examQuestions.year, subject: examQuestions.subject }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech"));
  return Response.json({
    items: items.map(item => {
      const topic = topicOf(item);
      return {
        ...item,
        options: JSON.parse(item.optionsJson || "{}"),
        topic,
        isSimulation: item.examType === "mcq",
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
  if (body.repairSourceOrder === true) {
    const sourceUrl = String(body.sourceUrl ?? "").trim();
    if (!sourceUrl) return Response.json({ error: "缺少題目來源" }, { status: 400 });
    const db = await getDb();
    const repaired = await repairDuplicateSourceOrders(db, sourceUrl);
    return Response.json({ repaired, sourceUrl });
  }
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
  const [duplicate] = await db.select().from(examQuestions)
    .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, sourceUrl), eq(examQuestions.questionNumber, questionNumber), eq(examQuestions.stem, sanitizeRichHtml(stem))))
    .limit(1);
  if (duplicate) {
    if (sourceOrder !== null) {
      const sameOrder = await db.select({ id: examQuestions.id })
        .from(examQuestions)
        .where(and(
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.sourceUrl, sourceUrl),
          eq(examQuestions.sourceOrder, sourceOrder),
          ne(examQuestions.id, duplicate.id),
        ))
        .limit(1);
      if (sameOrder.length) {
        await shiftSourceOrders(db, sourceUrl, sourceOrder, duplicate.id);
        await db.update(examQuestions).set({ sourceOrder }).where(eq(examQuestions.id, duplicate.id));
        const [repaired] = await db.select().from(examQuestions).where(eq(examQuestions.id, duplicate.id)).limit(1);
        return Response.json({ item: { ...repaired, options: JSON.parse(repaired.optionsJson || "{}") }, created: false, existing: true, orderRepaired: true });
      }
    }
    return Response.json({ item: { ...duplicate, options: JSON.parse(duplicate.optionsJson || "{}") }, created: false, existing: true });
  }
  if (sourceOrder !== null) await shiftSourceOrders(db, sourceUrl, sourceOrder);
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
  const db = await getDb();
  if (body.bulkConfirmReview === true) {
    const requestedQuestionIds = Array.isArray(body.questionIds)
      ? [...new Set(body.questionIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0))]
      : [];
    try {
      const rows: Array<{ id: number; teacherAnswer: string | null; correctAnswer: string | null }> = [];
      if (requestedQuestionIds.length) {
        for (const questionId of requestedQuestionIds) {
          const [row] = await db.select({ id: examQuestions.id, teacherAnswer: examQuestions.teacherAnswer, correctAnswer: examQuestions.correctAnswer })
            .from(examQuestions)
            .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.id, questionId)))
            .limit(1);
          if (row) rows.push(row);
        }
      } else {
        const documentId = Number(body.documentId);
        if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "缺少有效文件編號" }, { status: 400 });
        const [document] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName })
          .from(documents)
          .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
          .limit(1);
        if (!document) return Response.json({ error: "找不到指定的醫檢文件" }, { status: 404 });
        const aliases = [...new Set([`document:${documentId}`, document.storageKey, document.fileName].filter((value): value is string => Boolean(value)))];
        if (aliases.length) {
          const matchingRows = await db.select({ id: examQuestions.id, teacherAnswer: examQuestions.teacherAnswer, correctAnswer: examQuestions.correctAnswer })
            .from(examQuestions)
            .where(and(eq(examQuestions.examCategory, "medtech"), or(...aliases.map((alias) => eq(examQuestions.sourceUrl, alias)))));
          rows.push(...matchingRows);
        }
      }
      if (!rows.length) return Response.json({ error: "目前文件沒有可標記的題目" }, { status: 400 });
      for (const row of rows) {
        await db.update(examQuestions)
          .set({ reviewStatus: "confirmed", reviewedAt: new Date() })
          .where(and(eq(examQuestions.id, row.id), eq(examQuestions.examCategory, "medtech")));
      }
      const unanswered = rows.filter((row) => !/^[A-D]$/.test(String(row.teacherAnswer || row.correctAnswer || "").trim().toUpperCase())).length;
      return Response.json({ updated: rows.length, unanswered, questionIds: rows.map((item) => item.id), reviewStatus: "confirmed" });
    } catch (error) {
      console.error("[medtech] bulk review confirmation failed", error);
      return Response.json({ error: "批次校對狀態更新失敗，請稍後再試。" }, { status: 500 });
    }
  }
  const id = Number(body.id);
  if (body.publishAllDrafts === true) {
    const documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) {
      return Response.json({ error: "請從文件卡片按「發布此文件」，一次發布單一文件。" }, { status: 400 });
    }
    const [document] = await db.select({ id: documents.id, storageKey: documents.storageKey, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
      .limit(1);
    if (!document) return Response.json({ error: "找不到指定的醫檢文件" }, { status: 404 });
    const documentSources = [...new Set([`document:${document.id}`, document.storageKey, document.fileName].filter((value): value is string => Boolean(value)))];
    const sourceFilter = or(...documentSources.map((source) => eq(examQuestions.sourceUrl, source)));
    const draftRows = await db.select({ id: examQuestions.id, teacherAnswer: examQuestions.teacherAnswer, correctAnswer: examQuestions.correctAnswer, reviewStatus: examQuestions.reviewStatus, examName: examQuestions.examName, subject: examQuestions.subject, simulatedAnswer: examQuestions.simulatedAnswer })
      .from(examQuestions).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.examType, "mcq"),
      eq(examQuestions.status, "draft"),
      sourceFilter,
    ));
    const publishableRows = draftRows.filter((row) => hasPublishableAnswer(row));
    for (const row of publishableRows) {
      await db.update(examQuestions).set({ status: "published" }).where(and(eq(examQuestions.id, row.id), eq(examQuestions.examCategory, "medtech")));
    }
    const rows = publishableRows;
    const skippedUnanswered = draftRows.filter((row) => !hasPublishableAnswer(row)).length;
    if (!rows.length && draftRows.length) {
      return Response.json({ error: `本文件尚未發布任何題目：${skippedUnanswered} 題尚未設定有效的老師答案（需為 A、B、C 或 D）。`, updated: 0, skippedUnanswered, status: "draft" }, { status: 409 });
    }
    return Response.json({ updated: rows.length, skippedUnanswered, skipped: Math.max(0, draftRows.length - rows.length), documentId, status: "published" });
  }
  const [existing] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech"))).limit(1);
  if (!existing) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });

  if (body.confirmReview === true) {
    const answer = String(existing.teacherAnswer || existing.correctAnswer || "").trim().toUpperCase();
    if (!/^[A-D]$/.test(answer)) return Response.json({ error: "請先設定右側老師答案，再確認校對。" }, { status: 422 });
    if (!hasReviewableExplanation(existing)) return Response.json({ error: "請先確認至少有一段解析內容，再標記為已校對。" }, { status: 422 });
    const [updated] = await db.update(examQuestions).set({ reviewStatus: "confirmed", reviewedAt: new Date() }).where(eq(examQuestions.id, id)).returning();
    return Response.json({ item: updated, reviewStatus: "confirmed" });
  }
  if (body.cancelReview === true) {
    const [updated] = await db.update(examQuestions).set({ reviewStatus: "pending", reviewedAt: null, status: existing.status === "published" ? "disabled" : existing.status }).where(eq(examQuestions.id, id)).returning();
    return Response.json({ item: updated, reviewStatus: "pending", unpublished: existing.status === "published" });
  }
  if (body.status === "published" && existing.reviewStatus !== "confirmed" && !hasTeacherAnswer(existing)) {
    return Response.json({ error: "本題尚未完成校對，請先按「確認校對完成」後再發布。" }, { status: 409 });
  }
  const allowed = ["year","subject","questionNumber","stem","correctAnswer","teacherAnswer","explanation","completeExplanation","aiCompleteExplanation","teacherCompleteExplanation","voiceScript","answerSource","answerStatus","simulatedAnswer","simulatedExplanation","simulatedCompleteExplanation","simulatedSource","simulatedAnswerStatus","simulatedTeacherNote","status"] as const;
  const values: Record<string,string | number | null> = {};
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
  const contentKeys = ["year","subject","questionNumber","stem","correctAnswer","teacherAnswer","explanation","completeExplanation","aiCompleteExplanation","teacherCompleteExplanation","voiceScript","simulatedAnswer","simulatedExplanation","simulatedCompleteExplanation","options"];
  if (contentKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
    values.reviewStatus = "pending";
    values.reviewedAt = null;
    if (existing.status === "published") values.status = "disabled";
  }
  if (body.options && typeof body.options === "object") values.optionsJson = JSON.stringify(Object.fromEntries(Object.entries(body.options).map(([key,value])=>[key,sanitizeRichHtml(String(value))])));
  if (body.sourceOrder !== undefined) {
    const sourceOrder = Number(body.sourceOrder);
    values.sourceOrder = Number.isInteger(sourceOrder) && sourceOrder > 0 ? sourceOrder : null;
  }
  await db.update(examQuestions).set(values).where(eq(examQuestions.id, id));
  return Response.json({ updated: true });
}

export async function DELETE(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const { id: rawId } = await request.json() as { id?: number };
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少有效題目編號" }, { status: 400 });
  const db = await getDb();
  const [question] = await db.select({ id: examQuestions.id, sourceUrl: examQuestions.sourceUrl })
    .from(examQuestions)
    .where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech")))
    .limit(1);
  if (!question) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });

  const solutions = await db.select({ id: listeningSolutions.id, audioStorageKey: listeningSolutions.audioStorageKey })
    .from(listeningSolutions)
    .where(eq(listeningSolutions.questionId, id));
  const segments = solutions.length
    ? await db.select({ storageKey: listeningAudioSegments.storageKey })
      .from(listeningAudioSegments)
      .where(inArray(listeningAudioSegments.listeningId, solutions.map((solution) => solution.id)))
    : [];
  try {
    const { env } = await import("cloudflare:workers");
    for (const solution of solutions) if (solution.audioStorageKey) await env.BUCKET.delete(solution.audioStorageKey).catch(() => undefined);
    for (const segment of segments) await env.BUCKET.delete(segment.storageKey).catch(() => undefined);
  } catch {
    // The database delete should still succeed if object storage cleanup is unavailable.
  }
  for (const solution of solutions) {
    await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, solution.id));
    await db.delete(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, solution.id));
  }
  await db.delete(listeningSolutions).where(eq(listeningSolutions.questionId, id));
  await db.delete(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech")));

  const documentId = Number(question.sourceUrl.replace(/^document:/, ""));
  if (Number.isInteger(documentId) && documentId > 0) {
    const [nextCount] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions)
      .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, `document:${documentId}`)));
    await db.update(documents).set({
      questionCount: Number(nextCount?.total ?? 0),
      processingMessage: `已刪除題目，目前共 ${Number(nextCount?.total ?? 0)} 題`,
    }).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")));
  }
  return Response.json({ deleted: true, id });
}
