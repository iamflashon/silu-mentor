import { and, asc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb } from "../../../db";
import { legalArticles, legalDocuments } from "../../../db/schema";

const CORE_LAW_NAMES = new Set([
  "憲法",
  "行政法",
  "民法",
  "民事訴訟法",
  "刑法",
  "刑事訴訟法",
]);

const CORE_LAW_TITLES: Record<string, string[]> = {
  "憲法": ["中華民國憲法", "中華民國憲法增修條文"],
  "民法": ["民法"],
  "民事訴訟法": ["民事訴訟法"],
  "刑法": ["中華民國刑法"],
  "刑事訴訟法": ["刑事訴訟法"],
};

function exactCoreLawTitle(lawName: string): SQL | null {
  const titles = CORE_LAW_TITLES[lawName];
  if (!titles?.length) return null;
  return or(...titles.map((title) => eq(legalDocuments.title, title))) ?? null;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeSearchText(value: string) {
  return value
    .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, "");
}

function parseLawQuery(value: string) {
  const normalized = normalizeSearchText(value);
  const articleMatch = normalized.match(/第(\d+)(?:條|条)(?:之(\d+))?/);
  if (!articleMatch || articleMatch.index === undefined) {
    return {
      normalized,
      lawName: CORE_LAW_NAMES.has(normalized) ? normalized : "",
      articleNumber: "",
    };
  }
  return {
    normalized,
    lawName: normalized.slice(0, articleMatch.index),
    articleNumber: articleMatch[1],
  };
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
    const parsed = parseLawQuery(query);
    const conditions = [eq(legalDocuments.status, "active")];
    if (parsed.articleNumber) {
      const articlePattern = `%${escapeLike(parsed.articleNumber)}%`;
      const articleCondition = like(legalArticles.articleNo, articlePattern);
      const exactTitleCondition = parsed.lawName ? exactCoreLawTitle(parsed.lawName) : null;
      conditions.push(
        parsed.lawName
          ? and(exactTitleCondition ?? like(legalDocuments.title, `%${escapeLike(parsed.lawName)}%`), articleCondition)
          : articleCondition,
      );
    } else if (parsed.lawName) {
      // Core laws use official-title matching. In particular, searching 民法
      // must not return 國民法官法 or regulations whose title merely contains
      // the same two characters.
      conditions.push(exactCoreLawTitle(parsed.lawName) ?? like(legalDocuments.title, `%${escapeLike(parsed.lawName)}%`));
    } else {
      conditions.push(
        or(
          like(legalDocuments.title, pattern),
          like(legalDocuments.classification, pattern),
          like(legalArticles.articleNo, pattern),
          like(legalArticles.content, pattern),
          like(legalArticles.hierarchy, pattern),
        ),
      );
    }
    if (category && ["法律", "命令"].includes(category)) conditions.push(eq(legalDocuments.category, category));

    const rows = await db
      .select({
        documentId: legalDocuments.id,
        title: legalDocuments.title,
        category: legalDocuments.category,
        classification: legalDocuments.classification,
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
