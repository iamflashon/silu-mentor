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
  const matches = await searchExternalCatalog(target.title, 12);
  const relevant = matches.filter((match) => match.id === target.id || match.parentTitle === target.title || match.title === target.title);
  const descendants = relevant.filter((match) => match.id !== target.id && match.parentTitle === target.title);
  const found = relevant.length > 0;
  const complete = descendants.length > 0 || (meta.depth ?? 1) >= 3;
  const failureReason = !target.recommended || target.reviewStatus !== "published"
    ? "此筆資料尚未同時啟用並發布，因此首頁不會使用。"
    : !found
      ? "首頁相同檢索流程沒有命中這筆資料；索引文字可能不足或分類未納入。"
      : !complete
        ? "目前只能命中期數／入口，沒有命中其下的實際文章；文章目錄可能尚未建立或未啟用。"
        : "";
  return Response.json({ query: target.title, found, complete, failureReason, target: { id: target.id, title: target.title, enabled: target.recommended, indexed: target.reviewStatus === "published", parentTitle: meta.parentTitle ?? "" }, matches: relevant.map((match) => ({ ...match, excerpt: (match.content || match.summary || match.title).slice(0, 260) })) });
}
