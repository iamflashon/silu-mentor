import { and, asc, eq, like, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { legalArticles, legalDocuments } from "../../../db/schema";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function articleOrder(articleNo: string, fallbackId: number) {
  const normalized = articleNo.replace(/\s+/g, "");
  const match = normalized.match(/第(\d+)(?:條)?(?:[-之](\d+))?(?:條)?(?:之(\d+))?/);
  if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, fallbackId];
  return [Number(match[1]), Number(match[2] ?? match[3] ?? 0), fallbackId];
}

function compareArticles(
  left: { articleNo: string; id: number },
  right: { articleNo: string; id: number },
) {
  const leftOrder = articleOrder(left.articleNo, left.id);
  const rightOrder = articleOrder(right.articleNo, right.id);
  for (let index = 0; index < leftOrder.length; index += 1) {
    if (leftOrder[index] !== rightOrder[index]) return leftOrder[index] - rightOrder[index];
  }
  return 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceKey = (url.searchParams.get("sourceKey") ?? "moj-regulations").trim().slice(0, 80);
  const category = (url.searchParams.get("category") ?? "").trim().slice(0, 40);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const documentId = Number(url.searchParams.get("documentId") ?? 0);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  try {
    const db = await getDb();
    if (documentId > 0) {
      const [document] = await db.select().from(legalDocuments).where(and(eq(legalDocuments.id, documentId), eq(legalDocuments.status, "active"))).limit(1);
      if (!document) return Response.json({ error: "找不到這筆法規內容" }, { status: 404 });
      const articles = (await db.select().from(legalArticles).where(eq(legalArticles.documentId, document.id))).sort(compareArticles);
      return Response.json({ document, articles });
    }

    const conditions = [eq(legalDocuments.sourceKey, sourceKey), eq(legalDocuments.status, "active")];
    if (category) conditions.push(eq(legalDocuments.category, category));
    if (query) conditions.push(like(legalDocuments.title, `%${escapeLike(query)}%`));

    const documents = await db.select({
      id: legalDocuments.id,
      title: legalDocuments.title,
      category: legalDocuments.category,
      classification: legalDocuments.classification,
      modifiedDate: legalDocuments.modifiedDate,
      sourceUrl: legalDocuments.sourceUrl,
      articleCount: sql<number>`count(${legalArticles.id})`,
    }).from(legalDocuments).leftJoin(legalArticles, eq(legalArticles.documentId, legalDocuments.id)).where(and(...conditions)).groupBy(legalDocuments.id).orderBy(asc(legalDocuments.title)).limit(limit).offset(offset);

    const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(and(eq(legalDocuments.sourceKey, sourceKey), eq(legalDocuments.status, "active"))).groupBy(legalDocuments.category);
    return Response.json({ documents, categoryCounts: Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)])), offset, limit });
  } catch {
    return Response.json({ error: "法規內容暫時無法讀取" }, { status: 503 });
  }
}
