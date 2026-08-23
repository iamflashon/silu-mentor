import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentSearchUnits, documents } from "../../../../db/schema";
import { documentExtension, inspectDocumentBytes, resolveDocumentPayload } from "../../../../lib/document-processing";

const PAGE_BATCH = 8;
const TARGET_CHARS = 760;
const OVERLAP_CHARS = 120;

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-Hant");
}

function cleanExtractedText(value: string) {
  return value.replace(/\uF06C/gu, "•").replace(/\uF0E0/gu, "→").replace(/[\uE000-\uF8FF]/gu, " ").replace(/\\n/gu, "\n");
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

async function insertRowsSafely(db: Awaited<ReturnType<typeof getDb>>, rows: Awaited<ReturnType<typeof rowsForPage>>) {
  let attempted = 0;
  // D1 has a bounded SQL-variable count. Fine-index rows have many columns,
  // so large textbook pages must be inserted in small idempotent groups.
  for (let index = 0; index < rows.length; index += 5) {
    const batch = rows.slice(index, index + 5);
    await db.insert(documentSearchUnits).values(batch).onConflictDoNothing();
    attempted += batch.length;
  }
  return attempted;
}

export async function buildFineIndexStep(documentId: number, options: { restart?: boolean; forceReset?: boolean } = {}) {
  try {
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
    const db = await getDb("primary");
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
    // Normal rebuild requests are resumable: never erase a usable index merely
    // because the browser refreshed or the client loop was interrupted.
    // A true destructive reset must be explicitly requested by a separate UI.
    if (options.restart && options.forceReset) await db.delete(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));

    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(document.storageKey);
    if (!object) return Response.json({ error: "找不到教材原始檔" }, { status: 404 });
    const bytes = await object.arrayBuffer();
    if (/\.local-index\.jsonl$/iu.test(document.fileName)) {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/u, "");
      const records = decoded.split(/\r?\n/u).map((line) => {
        try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
      }).filter((item): item is Record<string, unknown> => Boolean(item && typeof item.text === "string"));
      const [{ total: existing, pages: existingPages }] = await db.select({ total: sql<number>`count(*)`, pages: sql<number>`count(${documentSearchUnits.pageStart})` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
      // Older local-index builds treated the whole JSONL file as plain text,
      // producing null page numbers and visible JSON boundaries. Rebuild those
      // records once into page-aware clean units.
      const hasLegacyUnits = Number(existing) > 0 && Number(existingPages) < Number(existing);
      if (Number(existing) > 0 && !hasLegacyUnits) return Response.json({ done: true, pagesDone: records.length, totalPages: records.length, units: Number(existing), inserted: 0 });
      let inserted = 0;
      for (const [recordIndex, record] of records.entries()) {
        const page = Number(record.page_start) || recordIndex + 1;
        const rows = await rowsForPage(documentId, page, cleanExtractedText(String(record.text)));
        if (rows.length) inserted += await insertRowsSafely(db, rows);
      }
      // Keep the old fallback units available while the clean page-aware rows
      // are being written. Remove only the invalid null-page rows afterwards.
      if (hasLegacyUnits) await db.delete(documentSearchUnits).where(and(eq(documentSearchUnits.documentId, documentId), isNull(documentSearchUnits.pageStart)));
      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
      return Response.json({ done: true, pagesDone: records.length, totalPages: records.length, units: Number(total), inserted });
    }
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
          if (rows.length) inserted += await insertRowsSafely(db, rows);
        }
        const done = endPage >= pdf.numPages;
        // A legacy whole-document index may coexist during repair. It remains
        // searchable until every PDF page is safely present, then only those
        // obsolete null-page rows are removed.
        if (done) await db.delete(documentSearchUnits).where(and(eq(documentSearchUnits.documentId, documentId), isNull(documentSearchUnits.pageStart)));
        const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
        return Response.json({ done, pagesDone: endPage, totalPages: pdf.numPages, units: Number(total), inserted });
      } finally { await pdf.cleanup(); }
    }

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
    if (Number(total) > 0) return Response.json({ done: true, pagesDone: 1, totalPages: 1, units: Number(total), inserted: 0 });
    const inspected = await inspectDocumentBytes(source.fileName, source.bytes);
    const rows = await rowsForPage(documentId, null, inspected.text);
    await insertRowsSafely(db, rows);
    return Response.json({ done: true, pagesDone: 1, totalPages: 1, units: rows.length, inserted: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "精準搜尋索引建立失敗" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json() as { documentId?: number; restart?: boolean; forceReset?: boolean };
  return buildFineIndexStep(Number(body.documentId), body);
}

export async function GET(request: Request) {
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
  const db = await getDb("primary");
  const [{ units, pages }] = await db.select({ units: sql<number>`count(*)`, pages: sql<number>`count(distinct ${documentSearchUnits.pageStart})` })
    .from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId));
  return Response.json({ units: Number(units), pages: Number(pages) }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
