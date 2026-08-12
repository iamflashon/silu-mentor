import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const SOURCES = {
  lawdata: { label: "月旦法學教室", url: "https://lawdata.com.tw/tw/journal_list.aspx?no=140", hosts: ["lawdata.com.tw"] },
  get: { label: "高點出版", url: "https://publish.get.com.tw/", hosts: ["publish.get.com.tw"] },
  ibrain: { label: "iBrain 知識達", url: "https://www.ibrain.com.tw/Audition/List.aspx?1=1&iC=2089", hosts: ["www.ibrain.com.tw", "ibrain.com.tw"] },
} as const;

type SourceKey = keyof typeof SOURCES;

function cleanHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

function discoverLinks(html: string, base: string, source: SourceKey) {
  const seen = new Set<string>();
  const rows: Array<{ title: string; url: string; summary: string }> = [];
  const matches = html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of matches) {
    const title = cleanHtml(match[2]).slice(0, 160);
    if (title.length < 4 || /^(更多|more|回首頁|首頁|登入|註冊|上一頁|下一頁)$/i.test(title)) continue;
    let url: URL;
    try { url = new URL(match[1], base); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (!SOURCES[source].hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    const key = `${title}|${url.href}`;
    if (seen.has(key)) continue;
    const relevant = source === "lawdata"
      ? /journal|article|期|法學|教室|篇|月旦/i.test(`${title} ${url.pathname} ${url.search}`)
      : source === "get"
        ? /book|BKID|司律|律師|司法官|法學|刑法|民法|訴訟|行政法|憲法|商法/i.test(`${title} ${url.pathname} ${url.search}`)
        : /course|audition|試聽|司律|律師|司法官|法學|刑法|民法|訴訟|行政法|憲法|商法/i.test(`${title} ${url.pathname} ${url.search}`);
    if (!relevant) continue;
    seen.add(key);
    rows.push({ title, url: url.href, summary: source === "lawdata" ? "公開期刊／文章索引" : source === "get" ? "公開書籍／目錄索引" : "公開課程／試聽索引" });
    if (rows.length >= (source === "lawdata" ? 20 : 12)) break;
  }
  return rows;
}

async function sourceRows(db: Awaited<ReturnType<typeof requireAdmin>> extends infer _T ? any : never) {
  const resources = await db.select().from(learningResources).where(eq(learningResources.resourceType, "external_index")).orderBy(asc(learningResources.sortOrder));
  const ids = resources.map((row: typeof learningResources.$inferSelect) => row.id);
  const segments = ids.length ? await db.select().from(resourceSegments).where(and(inArray(resourceSegments.resourceId, ids), eq(resourceSegments.segmentType, "external_catalog"))).orderBy(asc(resourceSegments.sequence)) : [];
  return resources.map((resource: typeof learningResources.$inferSelect) => ({
    id: resource.id,
    key: resource.creator,
    label: resource.title,
    sourceUrl: resource.sourceUrl,
    status: resource.status,
    lastSyncedAt: resource.updatedAt,
    items: segments.filter((item: typeof resourceSegments.$inferSelect) => item.resourceId === resource.id).map((item: typeof resourceSegments.$inferSelect) => ({ id: item.id, title: item.title, url: item.sourceUrl, summary: item.summary, enabled: item.recommended && item.reviewStatus !== "disabled", indexed: item.reviewStatus === "published", accessType: "公開索引" })),
  }));
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  return Response.json({ sources: await sourceRows(auth.db) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { source?: SourceKey };
  const source = body.source;
  if (!source || !(source in SOURCES)) return Response.json({ error: "未知的同步來源" }, { status: 400 });
  const config = SOURCES[source];
  try {
    const response = await fetch(config.url, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!response.ok) throw new Error(`來源網站回應 ${response.status}`);
    const html = await response.text();
    const discovered = discoverLinks(html, response.url || config.url, source);
    if (!discovered.length) throw new Error("頁面已讀取，但目前沒有辨識到可用的公開索引");
    const [existing] = await auth.db.select().from(learningResources).where(and(eq(learningResources.resourceType, "external_index"), eq(learningResources.creator, source))).limit(1);
    const resource = existing ?? (await auth.db.insert(learningResources).values({ resourceType: "external_index", title: config.label, creator: source, subject: "綜合", description: "Demo 公開索引；不含付費全文", sourceUrl: config.url, accessType: "public_index", status: "active", sortOrder: Object.keys(SOURCES).indexOf(source) }).returning())[0];
    const current = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, resource.id), eq(resourceSegments.segmentType, "external_catalog")));
    for (let index = 0; index < discovered.length; index++) {
      const item = discovered[index];
      const row = current.find((candidate) => candidate.sourceUrl === item.url || candidate.title === item.title);
      const values = { lessonLabel: config.label, title: item.title, sourceUrl: item.url, text: JSON.stringify({ source, accessType: "public_index" }), summary: item.summary, importance: 3, reviewStatus: row?.reviewStatus === "disabled" ? "disabled" : "published", recommended: row?.reviewStatus === "disabled" ? false : true, sequence: index + 1 };
      if (row) await auth.db.update(resourceSegments).set(values).where(eq(resourceSegments.id, row.id));
      else await auth.db.insert(resourceSegments).values({ resourceId: resource.id, segmentType: "external_catalog", ...values });
    }
    await auth.db.update(learningResources).set({ status: "active", updatedAt: new Date() }).where(eq(learningResources.id, resource.id));
    return Response.json({ source, discovered: discovered.length, sources: await sourceRows(auth.db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "同步失敗" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; enabled?: boolean };
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "資料編號錯誤" }, { status: 400 });
  const [row] = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.id, id), eq(resourceSegments.segmentType, "external_catalog"))).limit(1);
  if (!row) return Response.json({ error: "找不到索引資料" }, { status: 404 });
  await auth.db.update(resourceSegments).set({ recommended: body.enabled === true, reviewStatus: body.enabled === true ? "published" : "disabled" }).where(eq(resourceSegments.id, id));
  return Response.json({ ok: true, enabled: body.enabled === true });
}
