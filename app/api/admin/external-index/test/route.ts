import { and, eq } from "drizzle-orm";
import { resourceSegments } from "../../../../../db/schema";
import { loadExternalCatalogRows, rankExternalCatalogRows } from "../../../../../lib/external-catalog-search";
import { requireAdmin } from "../../../../../lib/member-auth";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { itemId?: number };
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId)) return Response.json({ error: "資料編號錯誤" }, { status: 400 });
  const [target] = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.id, itemId), eq(resourceSegments.segmentType, "external_catalog"))).limit(1);
  if (!target) return Response.json({ error: "找不到要測試的索引資料" }, { status: 404 });
  let meta: { parentTitle?: string; depth?: number } = {};
  try { meta = JSON.parse(target.text || "{}"); } catch {}
  const rawRows = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, target.resourceId), eq(resourceSegments.segmentType, "external_catalog")));
  const allRows = rawRows.map((row) => { let rowMeta: { parentTitle?: string; depth?: number; content?: string } = {}; try { rowMeta = JSON.parse(row.text || "{}"); } catch {} return { ...row, rowMeta }; });
  const childrenOf = (title: string) => allRows.filter((row) => row.rowMeta.parentTitle === title);
  const directChildren = childrenOf(target.title);
  const descendants: typeof allRows = [];
  const queue = [...directChildren];
  const seen = new Set<number>();
  while (queue.length) {
    const row = queue.shift()!;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    descendants.push(row);
    queue.push(...childrenOf(row.title));
  }
  const scope = descendants.length ? descendants : [allRows.find((row) => row.id === target.id)!].filter(Boolean);
  const leafRows = scope.filter((row) => childrenOf(row.title).length === 0);
  const candidates = leafRows.length ? leafRows : scope;
  const catalogRows = await loadExternalCatalogRows();
  const issuePattern = /第\s*\d{1,4}\s*期/u;
  const classify = (row: typeof allRows[number]) => issuePattern.test(row.title) ? "issue" : issuePattern.test(row.rowMeta.parentTitle ?? "") || (row.rowMeta.depth ?? 1) >= 3 ? "article" : childrenOf(row.title).length ? "category" : "unresolved";
  const tests = candidates.map((candidate) => {
    let candidateMeta: { parentTitle?: string; depth?: number; content?: string } = {};
    try { candidateMeta = JSON.parse(candidate.text || "{}"); } catch {}
    const dataType = classify(candidate);
    const matches = rankExternalCatalogRows(catalogRows, candidate.title, 12);
    const relevant = matches.filter((match) => match.id === candidate.id || match.parentTitle === candidate.title || match.title === candidate.title);
    const childMatches = relevant.filter((match) => match.id !== candidate.id && match.parentTitle === candidate.title);
    const enabled = candidate.recommended && candidate.reviewStatus === "published";
    const found = relevant.length > 0;
    const complete = enabled && found && (dataType === "article" || (dataType === "issue" && childMatches.length > 0));
    const failureReason = !enabled
      ? "未同時啟用並發布，首頁不會使用。"
      : !found
        ? "已進入完整搜尋範圍但仍未命中；標題、期數或上層來源可能缺少可搜尋文字。"
        : dataType === "issue" && childMatches.length === 0
          ? "期數標題可命中，但此期尚未抓到可供首頁使用的文章。"
          : dataType === "unresolved"
            ? "這是沒有下層內容的分類入口，尚未形成期數或文章資料。"
        : !complete
          ? "只命中期數／入口，沒有命中其下的實際文章。"
          : "";
    return { id: candidate.id, title: candidate.title, parentTitle: candidateMeta.parentTitle ?? "", depth: candidateMeta.depth ?? 1, dataType, enabled: candidate.recommended, indexed: candidate.reviewStatus === "published", found, complete, failureReason, matches: relevant.map((match) => ({ ...match, excerpt: (match.content || match.summary || match.title).slice(0, 260) })) };
  });
  const hierarchy = { categories: scope.filter((row) => classify(row) === "category").length, issues: scope.filter((row) => classify(row) === "issue").length, articles: scope.filter((row) => classify(row) === "article").length, unresolved: scope.filter((row) => classify(row) === "unresolved").length };
  const stats = { total: tests.length, complete: tests.filter((test) => test.complete).length, titleOnly: tests.filter((test) => test.found && !test.complete).length, missing: tests.filter((test) => !test.found).length, disabled: tests.filter((test) => !test.enabled || !test.indexed).length };
  const found = stats.complete + stats.titleOnly > 0;
  const complete = stats.total > 0 && stats.complete === stats.total;
  const failureReason = complete ? "" : descendants.length ? `已遞迴檢查到底層：${stats.complete} 筆完整、${stats.titleOnly} 筆僅命中標題、${stats.missing} 筆找不到。` : tests[0]?.failureReason ?? "沒有可測試的資料。";
  return Response.json({ query: descendants.length ? `遞迴測試「${target.title}」直到最末層期數／文章` : target.title, mode: descendants.length ? "children" : "single", found, complete, failureReason, stats, hierarchy, tests, target: { id: target.id, title: target.title, enabled: target.recommended, indexed: target.reviewStatus === "published", parentTitle: meta.parentTitle ?? "" }, matches: tests.flatMap((test) => test.matches).slice(0, 30) });
}
