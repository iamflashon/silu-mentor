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

const RELATED_ARTICLE_NUMBERS: Record<string, string[]> = {
  "民法:184": ["185", "187", "188", "191", "191-2", "193", "195", "197"],
  "中華民國刑法:271": ["25", "26", "27", "28", "29", "30", "272", "275"],
  "刑法:271": ["25", "26", "27", "28", "29", "30", "272", "275"],
};

const LEGAL_QUERY_EXPANSIONS: Record<string, string[]> = {
  "舉證責任": ["證明責任", "舉證", "證明"],
  "正當防衛": ["現在不法侵害", "防衛", "防衛過當"],
  "行政處分": ["行政行為", "撤銷訴訟", "訴願"],
  "因果關係": ["相當因果關係", "客觀歸責"],
  "不作為犯": ["保證人地位", "作為義務"],
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

function decomposeLegalQuery(value: string) {
  const normalized = value
    .replace(/[，、；;＋+×]/g, " ")
    .replace(/(?:以及|與|和|及|還有|比較|關係)/g, " ")
    .replace(/[「」『』()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const terms = [...new Set(normalized.split(" ").map((term) => term.trim()).filter((term) => term.length >= 2))].slice(0, 6);
  const expandedTerms = [...new Set(terms.flatMap((term) => LEGAL_QUERY_EXPANSIONS[term] ?? []))]
    .filter((term) => !terms.includes(term))
    .slice(0, 10);
  return {
    terms: terms.length ? terms : [value.trim()],
    expandedTerms,
    intent: terms.length > 1 ? "compare" : "lookup",
  } as const;
}

function searchConditionFor(term: string) {
  const pattern = `%${escapeLike(term)}%`;
  return or(
    like(legalDocuments.title, pattern),
    like(legalDocuments.classification, pattern),
    like(legalArticles.articleNo, pattern),
    like(legalArticles.content, pattern),
    like(legalArticles.hierarchy, pattern),
  );
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

function articleNumberOf(value: string) {
  const normalized = normalizeSearchText(value).replace(/條之/g, "-");
  const match = normalized.match(/第?(\d+)(?:條)?(?:之|-)?(\d+)?/);
  return match ? `${match[1]}${match[2] ? `-${match[2]}` : ""}` : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const category = (url.searchParams.get("category") ?? "").trim();
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") ?? 12) || 12));

  if (!query) return Response.json({ query: "", results: [], message: "請輸入法規名稱、條號或關鍵字" });

  try {
    const db = await getDb();
    const parsed = parseLawQuery(query);
    const analysis = decomposeLegalQuery(query);
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
      const searchableTerms = [...analysis.terms, ...analysis.expandedTerms];
      conditions.push(or(...searchableTerms.map(searchConditionFor)));
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

    let selectedRows = rows;
    let relatedRows: typeof rows = [];
    if (parsed.articleNumber) {
      // 條號查詢必須精準比對，避免第 184 條誤命中第 1184 條。
      selectedRows = rows.filter((row) => articleNumberOf(row.articleNo) === parsed.articleNumber);
      const officialTitle = parsed.lawName ? CORE_LAW_TITLES[parsed.lawName]?.[0] ?? parsed.lawName : "";
      const relatedNumbers = RELATED_ARTICLE_NUMBERS[`${officialTitle}:${parsed.articleNumber}`]
        ?? RELATED_ARTICLE_NUMBERS[`${parsed.lawName}:${parsed.articleNumber}`]
        ?? [];
      if (relatedNumbers.length && parsed.lawName) {
        const relatedCandidates = await db
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
          .where(and(
            eq(legalDocuments.status, "active"),
            exactCoreLawTitle(parsed.lawName) ?? like(legalDocuments.title, `%${escapeLike(parsed.lawName)}%`),
            or(...relatedNumbers.map((number) => like(legalArticles.articleNo, `%${escapeLike(number)}%`))),
          ))
          .limit(30);
        relatedRows = relatedCandidates
          .filter((row) => relatedNumbers.includes(articleNumberOf(row.articleNo)))
          .sort((left, right) => relatedNumbers.indexOf(articleNumberOf(left.articleNo)) - relatedNumbers.indexOf(articleNumberOf(right.articleNo)))
          .slice(0, 6);
      }
    }

    if (!parsed.articleNumber && !parsed.lawName && analysis.terms.length > 1) {
      selectedRows = [...rows].sort((left, right) => {
        const leftText = `${left.title} ${left.classification} ${left.hierarchy} ${left.content}`;
        const rightText = `${right.title} ${right.classification} ${right.hierarchy} ${right.content}`;
        const score = (text: string) => analysis.terms.reduce((total, term) => total + (text.includes(term) ? 4 : 0), 0)
          + analysis.expandedTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
        return score(rightText) - score(leftText);
      });
    }

    const results = [
      ...selectedRows.map((row) => ({ ...row, matchType: parsed.articleNumber ? "exact" : "content" })),
      ...relatedRows.map((row) => ({ ...row, matchType: "related" })),
    ].map((row) => ({
      ...row,
      excerpt: row.content.length > 220 ? `${row.content.slice(0, 220)}…` : row.content,
    }));
    return Response.json({ query, analysis, results, total: results.length });
  } catch {
    return Response.json({ error: "法規資料尚未就緒，請稍後再搜尋" }, { status: 503 });
  }
}
