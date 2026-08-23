import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentSearchUnits, documents } from "../../../../db/schema";
import { documentExtension, inspectDocumentBytes, resolveDocumentPayload } from "../../../../lib/document-processing";

const PAGE_BATCH = 1;
const TARGET_CHARS = 760;
const OVERLAP_CHARS = 120;

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-Hant");
}

function titleFromText(text: string, page: number | null, index: number) {
  const heading = text.split(/\n+/).map((line) => line.trim()).find((line) => /^(?:第.{1,12}[篇章節款目]|[一二三四五六七八九十百]+、|\d+(?:\.\d+){0,3}\s+\S)/u.test(line));
  return (heading || `${page ? `第 ${page} 頁` : "全文"}片段 ${index + 1}`).slice(0, 160);
}

function splitText(text: string) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const units: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs.length ? paragraphs : [clean]) {
    if (buffer && buffer.length + paragraph.length + 2 > TARGET_CHARS) {
      units.push(buffer.trim());
      buffer = `${buffer.slice(-OVERLAP_CHARS)}\n${paragraph}`;
    } else buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
    while (buffer.length > TARGET_CHARS * 1.7) {
      units.push(buffer.slice(0, TARGET_CHARS));
      buffer = buffer.slice(TARGET_CHARS - OVERLAP_CHARS);
    }
  }
  if (buffer.trim()) units.push(buffer.trim());
  return units.filter((item) => item.length >= 20);
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function rowsForPage(documentId: number, page: number | null, text: string) {
  const chunks = splitText(text);
  if (!chunks.length && page) chunks.push("[本頁沒有可擷取的文字層]");
  return Promise.all(chunks.map(async (chunk, index) => ({
    documentId,
    unitType: "paragraph_window",
    hierarchyPath: page ? `PDF 第 ${page} 頁` : "全文",
    title: titleFromText(chunk, page, index),
    pageStart: page,
    pageEnd: page,
    sequence: page ? page * 1000 + index : index + 1,
    text: chunk,
    normalizedText: normalize(chunk),
    keywordsJson: "[]",
    contentHash: await hash(chunk),
  })));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { documentId?: number; restart?: boolean; forceReset?: boolean };
    const documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
    const db = await getDb("primary");
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    // Normal rebuild requests are resumable: never erase a usable index merely
    // because the browser refreshed or the client loop was interrupted.
    // A true destructive reset must be explicitly requested by a separate UI.
    if (body.restart && body.forceReset) await db.delete(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));

    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "找不到教材原始檔" }, { status: 404 });
    const bytes = await object.arrayBuffer();
    const source = resolveDocumentPayload(document.fileName, document.contentType, bytes);
    const extension = documentExtension(source.fileName);

    if (extension === "pdf") {
      const [{ lastPage }] = await db.select({ lastPage: sql<number>`coalesce(max(${documentSearchUnits.pageStart}), 0)` })
        .from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
      const startPage = Math.max(1, Number(lastPage || 0) + 1);
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(source.bytes));
      let inserted = 0;
      try {
        const endPage = Math.min(pdf.numPages, startPage + PAGE_BATCH - 1);
        for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const text = (content.items as Array<Record<string, unknown>>).map((item) => typeof item.str === "string" ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
          page.cleanup();
          const rows = await rowsForPage(documentId, pageNumber, text);
          if (rows.length) { await db.insert(documentSearchUnits).values(rows); inserted += rows.length; }
        }
        const done = endPage >= pdf.numPages;
        const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
        return Response.json({ done, pagesDone: endPage, totalPages: pdf.numPages, units: Number(total), inserted });
      } finally { await pdf.cleanup(); }
    }

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
    if (Number(total) > 0) return Response.json({ done: true, pagesDone: 1, totalPages: 1, units: Number(total), inserted: 0 });
    const inspected = await inspectDocumentBytes(source.fileName, source.bytes);
    const rows = await rowsForPage(documentId, null, inspected.text);
    for (let index = 0; index < rows.length; index += 60) await db.insert(documentSearchUnits).values(rows.slice(index, index + 60));
    return Response.json({ done: true, pagesDone: 1, totalPages: 1, units: rows.length, inserted: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "精準搜尋索引建立失敗" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
  const db = await getDb("primary");
  const [{ units, pages }] = await db.select({ units: sql<number>`count(*)`, pages: sql<number>`count(distinct ${documentSearchUnits.pageStart})` })
    .from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
  return Response.json({ units: Number(units), pages: Number(pages) }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
