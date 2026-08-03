import { and, asc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { legalArticles, legalDocuments } from "../../../db/schema";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const category = (url.searchParams.get("category") ?? "").trim();
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") ?? 12) || 12));

  if (!query) return Response.json({ query: "", results: [], message: "請輸入法規名稱、條號或關鍵字" });

  try {
    const db = await getDb();
    const pattern = `%${escapeLike(query)}%`;
    const conditions = [
      eq(legalDocuments.status, "active"),
      or(
        like(legalDocuments.title, pattern),
        like(legalArticles.articleNo, pattern),
        like(legalArticles.content, pattern),
        like(legalArticles.hierarchy, pattern),
      ),
    ];
    if (category && ["法律", "命令"].includes(category)) conditions.push(eq(legalDocuments.category, category));

    const rows = await db
      .select({
        documentId: legalDocuments.id,
        title: legalDocuments.title,
        category: legalDocuments.category,
        modifiedDate: legalDocuments.modifiedDate,
        sourceUrl: legalDocuments.sourceUrl,
        articleNo: legalArticles.articleNo,
        hierarchy: legalArticles.hierarchy,
        content: legalArticles.content,
      })
      .from(legalArticles)
      .innerJoin(legalDocuments, eq(legalArticles.documentId, legalDocuments.id))
      .where(and(...conditions))
      .orderBy(asc(legalDocuments.title), asc(legalArticles.articleNo))
      .limit(limit);

    const results = rows.map((row) => ({
      ...row,
      excerpt: row.content.length > 220 ? `${row.content.slice(0, 220)}…` : row.content,
    }));
    return Response.json({ query, results, total: results.length });
  } catch {
    return Response.json({ error: "法規資料尚未就緒，請稍後再搜尋" }, { status: 503 });
  }
}
