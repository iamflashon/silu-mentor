import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
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
    return Response.json({ item: { ...item, options: JSON.parse(item.optionsJson || "{}") } });
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
  let documentSources: string[] = [];
  if (Number.isInteger(documentId) && documentId > 0) {
    const [document] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech")))
      .limit(1);
    documentSources = [...new Set([`document:${documentId}`, document?.storageKey, document?.fileName].filter((value): value is string => Boolean(value)))];
  }
  const filters = [
    eq(examQuestions.examCategory, "medtech"),
    ...(query ? [or(like(examQuestions.stem, `%${query}%`), like(examQuestions.explanation, `%${query}%`), like(examQuestions.questionNumber, `%${query}%`))!] : []),
    ...(year ? [eq(examQuestions.year, year)] : []),
    ...(subject ? [eq(examQuestions.subject, subject)] : []),
    ...(status ? [eq(examQuestions.status, status)] : []),
    ...(documentSources.length ? [or(...documentSources.map(source => eq(examQuestions.sourceUrl, source)))] : []),
  ];
  const where = and(...filters);
  const [countRow] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(where);
  const [draftRow] = await db.select({ total: sql<number>`count(*)` }).from(examQuestions).where(and(
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
    eq(examQuestions.status, "draft"),
  ));
  const items = await db.select().from(examQuestions).where(where).orderBy(sourceOrder && Number.isInteger(documentId) && documentId > 0 ? asc(examQuestions.id) : desc(examQuestions.id)).limit(limit).offset((page - 1) * limit);
  const facets = await db.select({ year: examQuestions.year, subject: examQuestions.subject }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech"));
  return Response.json({
    items: items.map(item => ({ ...item, options: JSON.parse(item.optionsJson || "{}") })),
    total: Number(countRow?.total ?? 0), draftTotal: Number(draftRow?.total ?? 0), page, limit,
    years: [...new Set(facets.map(item => item.year).filter(Boolean))].sort((a,b)=>b.localeCompare(a,"zh-Hant",{numeric:true})),
    subjects: [...new Set(facets.map(item => item.subject).filter(Boolean))].sort(),
  });
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
      const nextOptions = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, replace(String(value ?? ""))]));
      const changed = nextStem !== row.stem || nextExplanation !== row.explanation || JSON.stringify(nextOptions) !== JSON.stringify(options);
      if (!changed) continue;
      matched += 1;
      await db.update(examQuestions).set({ stem: sanitizeRichHtml(nextStem), explanation: sanitizeRichHtml(nextExplanation), optionsJson: JSON.stringify(Object.fromEntries(Object.entries(nextOptions).map(([key, value]) => [key, sanitizeRichHtml(value)]))) }).where(eq(examQuestions.id, row.id));
    }
    return Response.json({ replaced: true, matched, updated: matched, find: replaceFind, replaceWith: replacement });
  }
  const id = Number(body.id);
  const db = await getDb();
  if (body.publishAllDrafts === true) {
    const rows = await db.update(examQuestions).set({ status: "published" }).where(and(
      eq(examQuestions.examCategory, "medtech"),
      eq(examQuestions.examType, "mcq"),
      eq(examQuestions.status, "draft"),
    )).returning({ id: examQuestions.id });
    return Response.json({ updated: rows.length, status: "published" });
  }
  const [existing] = await db.select({ id: examQuestions.id }).from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech"))).limit(1);
  if (!existing) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
  const allowed = ["year","subject","questionNumber","stem","correctAnswer","explanation","answerSource","status"] as const;
  const values: Record<string,string> = {};
  for (const key of allowed) if (typeof body[key] === "string") values[key] = ["stem","explanation"].includes(key) ? sanitizeRichHtml(String(body[key]).trim()) : String(body[key]).trim();
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
