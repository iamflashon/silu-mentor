import { and, eq } from "drizzle-orm";
import { resourceSegments } from "../../../../../db/schema";
import { searchExternalCatalog } from "../../../../../lib/external-catalog-search";
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
  const allRows = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, target.resourceId), eq(resourceSegments.segmentType, "external_catalog")));
  const children = allRows.filter((row) => { try { return JSON.parse(row.text || "{}").parentTitle === target.title; } catch { return false; } });
  const candidates = children.length ? children : [target];
  const tests = await Promise.all(candidates.map(async (candidate) => {
    let candidateMeta: { parentTitle?: string; depth?: number; content?: string } = {};
    try { candidateMeta = JSON.parse(candidate.text || "{}"); } catch {}
    const matches = await searchExternalCatalog(candidate.title, 12);
    const relevant = matches.filter((match) => match.id === candidate.id || match.parentTitle === candidate.title || match.title === candidate.title);
    const childMatches = relevant.filter((match) => match.id !== candidate.id && match.parentTitle === candidate.title);
    const enabled = candidate.recommended && candidate.reviewStatus === "published";
    const found = relevant.length > 0;
    const isLeaf = !allRows.some((row) => { try { return JSON.parse(row.text || "{}").parentTitle === candidate.title; } catch { return false; } });
    const complete = enabled && found && (isLeaf || childMatches.length > 0);
    const failureReason = !enabled
      ? "未同時啟用並發布，首頁不會使用。"
      : !found
        ? "首頁相同檢索流程沒有命中；索引文字可能不足。"
        : !complete
          ? "只命中期數／入口，沒有命中其下的實際文章。"
          : "";
    return { id: candidate.id, title: candidate.title, parentTitle: candidateMeta.parentTitle ?? "", depth: candidateMeta.depth ?? 1, enabled: candidate.recommended, indexed: candidate.reviewStatus === "published", found, complete, failureReason, matches: relevant.map((match) => ({ ...match, excerpt: (match.content || match.summary || match.title).slice(0, 260) })) };
  }));
  const stats = { total: tests.length, complete: tests.filter((test) => test.complete).length, titleOnly: tests.filter((test) => test.found && !test.complete).length, missing: tests.filter((test) => !test.found).length, disabled: tests.filter((test) => !test.enabled || !test.indexed).length };
  const found = stats.complete + stats.titleOnly > 0;
  const complete = stats.total > 0 && stats.complete === stats.total;
  const failureReason = complete ? "" : children.length ? `下層 ${stats.total} 筆中，${stats.complete} 筆完整、${stats.titleOnly} 筆僅命中標題、${stats.missing} 筆找不到。` : tests[0]?.failureReason ?? "沒有可測試的資料。";
  return Response.json({ query: children.length ? `批次測試「${target.title}」的 ${children.length} 筆下層資料` : target.title, mode: children.length ? "children" : "single", found, complete, failureReason, stats, tests, target: { id: target.id, title: target.title, enabled: target.recommended, indexed: target.reviewStatus === "published", parentTitle: meta.parentTitle ?? "" }, matches: tests.flatMap((test) => test.matches).slice(0, 30) });
}
