import { and, asc, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSearchUnits, documentSectionMappings, documents } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { PENGLI_THEME_TITLES } from "../../../../../lib/pengli-book-toc";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  const requested = params.get("topic")?.trim() ?? PENGLI_THEME_TITLES[0];
  const themeIndex = PENGLI_THEME_TITLES.findIndex((title) => title === requested || title.includes(requested) || requested.includes(title));
  if (themeIndex < 0) return Response.json({ error: "找不到這個主題。" }, { status: 400 });
  const pageIndex = Math.max(0, Math.min(999, Number(params.get("page") || 0) || 0));
  const db = await getDb("primary");
  const direct = await db.select({ id: documents.id }).from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%"))).orderBy(desc(documents.id)).limit(10);
  const assigned = await db.select({ id: documents.id }).from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true))).orderBy(desc(documents.id)).limit(10);
  const ids = [...new Set([...assigned, ...direct].map((row) => row.id))];
  if (!ids.length) return Response.json({ error: "章節內容尚未完成上架。" }, { status: 404 });
  const [mapping] = await db.select().from(documentSectionMappings).where(and(
    inArray(documentSectionMappings.documentId, ids),
    eq(documentSectionMappings.sectionKey, `theme_${themeIndex + 1}`),
    eq(documentSectionMappings.verified, true),
  )).orderBy(desc(documentSectionMappings.documentId)).limit(1);
  if (!mapping) return Response.json({ error: "這個主題的章節範圍尚未確認。" }, { status: 404 });
  const pages = await db.select({ page: documentSearchUnits.pageStart }).from(documentSearchUnits).where(and(
    eq(documentSearchUnits.documentId, mapping.documentId),
    gte(documentSearchUnits.pageStart, mapping.pdfStartPage),
    lte(documentSearchUnits.pageStart, mapping.pdfEndPage),
  )).groupBy(documentSearchUnits.pageStart).orderBy(asc(documentSearchUnits.pageStart));
  const validPages = pages.map((row) => row.page).filter((page): page is number => page != null);
  const physicalPage = validPages[Math.min(pageIndex, Math.max(0, validPages.length - 1))];
  if (!physicalPage) return Response.json({ error: "這一章尚無可閱讀內容。" }, { status: 404 });
  const units = await db.select({ title: documentSearchUnits.title, hierarchyPath: documentSearchUnits.hierarchyPath, text: documentSearchUnits.text })
    .from(documentSearchUnits).where(and(eq(documentSearchUnits.documentId, mapping.documentId), eq(documentSearchUnits.pageStart, physicalPage)))
    .orderBy(asc(documentSearchUnits.sequence)).limit(12);
  const blocks = units.map((unit) => ({
    heading: unit.title.trim() || unit.hierarchyPath.split(" > ").at(-1)?.trim() || "章節內容",
    paragraphs: unit.text.replace(/\r/gu, "").split(/\n{2,}/u).map((text) => text.replace(/\s+/gu, " ").trim()).filter(Boolean),
  })).filter((block) => block.paragraphs.length);
  return Response.json({
    topic: PENGLI_THEME_TITLES[themeIndex], themeNumber: themeIndex + 1, blocks,
    page: pageIndex, pageCount: validPages.length,
    bookPageLabel: `${themeIndex + 1}-${physicalPage - mapping.pdfStartPage + 1}`,
  }, { headers: { "Cache-Control": "private, no-store", "Content-Disposition": "inline" } });
}
