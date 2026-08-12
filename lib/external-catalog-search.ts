import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { learningResources, resourceSegments } from "../db/schema";

export type ExternalCatalogMatch = {
  id: number;
  source: string;
  title: string;
  summary: string;
  url: string;
  enabled: boolean;
  indexed: boolean;
  parentTitle: string;
  depth: number;
  content: string;
  score: number;
};

export type ExternalCatalogRow = Omit<ExternalCatalogMatch, "score">;

function queryGrams(query: string) {
  const compact = query.replace(/\s+/g, "");
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2))
    .filter((gram) => !/^(什麼|哪些|如何|可以|推薦|相關|我要|請問)$/.test(gram));
}

export async function loadExternalCatalogRows(): Promise<ExternalCatalogRow[]> {
  const db = await getDb();
  const rows = await db.select({
    id: resourceSegments.id,
    source: learningResources.title,
    title: resourceSegments.title,
    summary: resourceSegments.summary,
    url: resourceSegments.sourceUrl,
    text: resourceSegments.text,
    recommended: resourceSegments.recommended,
    reviewStatus: resourceSegments.reviewStatus,
  })
    .from(resourceSegments)
    .innerJoin(learningResources, eq(resourceSegments.resourceId, learningResources.id))
    .where(and(
      eq(learningResources.resourceType, "external_index"),
      eq(learningResources.status, "active"),
      eq(resourceSegments.segmentType, "external_catalog"),
      eq(resourceSegments.reviewStatus, "published"),
      eq(resourceSegments.recommended, true),
    ));
  return rows.map((row) => {
    let meta: { parentTitle?: string; depth?: number; content?: string } = {};
    try { meta = JSON.parse(row.text || "{}"); } catch {}
    return { id: row.id, source: row.source, title: row.title, summary: row.summary, url: row.url, enabled: row.recommended, indexed: row.reviewStatus === "published", parentTitle: meta.parentTitle ?? "", depth: meta.depth ?? 1, content: meta.content ?? "" };
  });
}

export function rankExternalCatalogRows(rows: ExternalCatalogRow[], query: string, limit = 6): ExternalCatalogMatch[] {
  const compact = query.replace(/\s+/g, "");
  if (compact.length < 2) return [];
  const grams = queryGrams(query);
  const requestedIssue = compact.match(/第?\d{1,4}期/u)?.[0]?.replace(/^第/u, "") ?? "";
  return rows.map((row) => {
    const haystack = `${row.source}${row.title}${row.summary}${row.parentTitle}${row.content}`.replace(/\s+/g, "");
    const exactTitle = compact.includes(row.title.replace(/\s+/g, "")) || row.title.replace(/\s+/g, "").includes(compact);
    const exactParent = Boolean(row.parentTitle) && compact.includes(row.parentTitle.replace(/\s+/g, ""));
    const sameIssue = Boolean(requestedIssue) && haystack.includes(requestedIssue);
    const conflictingIssue = Boolean(requestedIssue) && /第?\d{1,4}期/u.test(haystack) && !sameIssue;
    const score = grams.reduce((total, gram) => total + (haystack.includes(gram) ? 1 : 0), 0) + (exactTitle ? 30 : 0) + (exactParent ? 20 : 0) + (sameIssue ? 40 : 0) - (conflictingIssue ? 50 : 0);
    return { ...row, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || b.depth - a.depth).slice(0, limit);
}

export async function searchExternalCatalog(query: string, limit = 6): Promise<ExternalCatalogMatch[]> {
  return rankExternalCatalogRows(await loadExternalCatalogRows(), query, limit);
}

export function formatExternalCatalogEvidence(rows: ExternalCatalogMatch[]) {
  if (!rows.length) return "";
  return `\n\n【管理後台已啟用的公開索引命中】\n${rows.map((row, index) => `${index + 1}. [${row.source}] ${row.title}｜${row.summary}｜${row.url}`).join("\n")}\n以上只有公開篇名、書名、課程名稱、目錄或試聽索引，不代表平台擁有或讀過全文。回答可推薦這些資源並附來源連結；不得補造作者主張、書中內容或課程講解。`;
}
