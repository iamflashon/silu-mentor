import { asc, desc, eq, like, or, sql } from "drizzle-orm";
import { documentSectionMappings, documentSearchUnits, documents } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const defaultSections = [
  { sectionKey: "front_matter", title: "封面、序言與目錄（不供 AI 回答）", sectionType: "front_matter", sortOrder: 0, pdfStartPage: 1, pdfEndPage: 22, verified: true },
  { sectionKey: "theme_1", title: "行政法理論基礎與行政組織法", sectionType: "body", sortOrder: 1, pdfStartPage: 23, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_2", title: "行政處分", sectionType: "body", sortOrder: 2, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_3", title: "行政契約與行政命令", sectionType: "body", sortOrder: 3, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_4", title: "行政罰法", sectionType: "body", sortOrder: 4, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_5", title: "行政執行法", sectionType: "body", sortOrder: 5, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_6", title: "訴願法與行政訴訟法", sectionType: "body", sortOrder: 6, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_7", title: "國家賠償法與損失補償", sectionType: "body", sortOrder: 7, pdfStartPage: 0, pdfEndPage: 0, verified: false },
  { sectionKey: "theme_8", title: "新進實務見解整理", sectionType: "body", sortOrder: 8, pdfStartPage: 0, pdfEndPage: 0, verified: false },
] as const;

async function book(auth: Awaited<ReturnType<typeof requireAdmin>>) {
  if ("error" in auth) return null;
  const [row] = await auth.db.select({ id: documents.id, fileName: documents.fileName, bookTitle: documents.bookTitle, pageCount: documents.pageCount, processingResultJson: documents.processingResultJson })
    .from(documents).where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%")))
    .orderBy(desc(sql<number>`case when ${documents.fileName} like '%.local-index.jsonl' then 1 else 0 end`), desc(documents.id)).limit(1);
  return row ?? null;
}

function sourceVariant(resultJson: string) {
  try {
    const parsed = JSON.parse(resultJson) as { sourceVariants?: Array<{ kind?: string; storageKey?: string }> };
    return (parsed.sourceVariants ?? []).some((item) => item.kind === "pdf" && item.storageKey);
  } catch { return false; }
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const selected = await book(auth);
  if (!selected) return Response.json({ error: "尚未找到彭狸行政法教材。" }, { status: 404 });
  const rows = await auth.db.select().from(documentSectionMappings).where(eq(documentSectionMappings.documentId, selected.id)).orderBy(asc(documentSectionMappings.sortOrder));
  const [pages] = await auth.db.select({ maxPage: sql<number>`coalesce(max(${documentSearchUnits.pageEnd}), max(${documentSearchUnits.pageStart}), 0)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, selected.id));
  const hasDirectPdf = /\.pdf$/iu.test(selected.fileName) || sourceVariant(selected.processingResultJson);
  const pdfCandidates = hasDirectPdf ? [] : await auth.db.select({ id: documents.id, fileName: documents.fileName }).from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%"))).orderBy(desc(documents.id)).limit(20);
  const separatePdf = pdfCandidates.find((item) => /\.pdf$/iu.test(item.fileName));
  return Response.json({
    document: { id: selected.id, title: selected.bookTitle || selected.fileName, fileName: selected.fileName, totalPages: Number(selected.pageCount || pages?.maxPage || 0), hasPdf: hasDirectPdf || Boolean(separatePdf) },
    sections: rows.length ? rows : defaultSections,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const selected = await book(auth);
  if (!selected) return Response.json({ error: "尚未找到彭狸行政法教材。" }, { status: 404 });
  const body = await request.json() as { sections?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.sections) || body.sections.length !== defaultSections.length) return Response.json({ error: "頁段資料不完整。" }, { status: 400 });
  const values = defaultSections.map((template) => {
    const incoming = body.sections?.find((item) => item.sectionKey === template.sectionKey);
    const start = Math.max(0, Math.floor(Number(incoming?.pdfStartPage ?? template.pdfStartPage)));
    const end = Math.max(0, Math.floor(Number(incoming?.pdfEndPage ?? template.pdfEndPage)));
    if ((end > 0 && start === 0) || (end > 0 && end < start)) throw new Error(`${template.title}的起訖頁不正確。`);
    return { documentId: selected.id, sectionKey: template.sectionKey, title: template.title, sectionType: template.sectionType, sortOrder: template.sortOrder, pdfStartPage: start, pdfEndPage: end, verified: start > 0 && end >= start, updatedAt: new Date() };
  });
  const completed = values.filter((item) => item.verified).sort((a, b) => a.pdfStartPage - b.pdfStartPage);
  if (completed.some((item, index) => index > 0 && item.pdfStartPage <= completed[index - 1].pdfEndPage)) return Response.json({ error: "章節頁段互相重疊，請重新確認起訖頁。" }, { status: 400 });
  for (const value of values) await auth.db.insert(documentSectionMappings).values(value).onConflictDoUpdate({ target: [documentSectionMappings.documentId, documentSectionMappings.sectionKey], set: value });
  return Response.json({ ok: true, sections: values }, { headers: { "cache-control": "no-store" } });
}
