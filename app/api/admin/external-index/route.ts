import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const SOURCES = {
  lawdata: { label: "元照／月旦全站資源", url: "https://www.angle.com.tw/", hosts: ["angle.com.tw", "www.angle.com.tw", "lawdata.com.tw", "www.lawdata.com.tw"] },
  get: { label: "高點出版", url: "https://publish.get.com.tw/", hosts: ["publish.get.com.tw"] },
  ibrain: { label: "iBrain 知識達", url: "https://www.ibrain.com.tw/Audition/List.aspx?1=1&iC=2089", hosts: ["www.ibrain.com.tw", "ibrain.com.tw"] },
} as const;

type SourceKey = keyof typeof SOURCES;

function cleanHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

function corruptionScore(value: string) {
  const replacementCharacters = (value.match(/\uFFFD/g) || []).length;
  const mojibakeRuns = (value.match(/[ÃÂæç¤¥¦§©ª«¬®¯°±²³]{2,}/g) || []).length;
  return replacementCharacters * 20 + mojibakeRuns * 8;
}

function looksCorrupted(value: string) {
  return corruptionScore(value) > 0 || /�{1,}|\?{4,}/.test(value);
}

async function readHtml(response: Response) {
  const bytes = await response.arrayBuffer();
  const headerCharset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  const asciiHead = new TextDecoder("windows-1252").decode(bytes.slice(0, 4096));
  const metaCharset = asciiHead.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/i)?.[1]
    ?? asciiHead.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/i)?.[1];
  const declared = (headerCharset || metaCharset || "").toLowerCase().replace(/_/g, "-");
  if (/big-?5|cp950|ms950/.test(declared)) return new TextDecoder("big5").decode(bytes);
  if (/utf-?8/.test(declared)) return new TextDecoder("utf-8").decode(bytes);

  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const big5 = new TextDecoder("big5").decode(bytes);
  return corruptionScore(big5) < corruptionScore(utf8) ? big5 : utf8;
}

function angleResourceType(value: string) {
  if (/journal|雜誌|期刊|月旦法學|法學教室/i.test(value)) return "期刊／文章索引";
  if (/book|書籍|新書|圖書|出版/i.test(value)) return "書籍／目錄索引";
  if (/course|lecture|影音|講座|研討|課程|學院/i.test(value)) return "講座／課程索引";
  if (/news|article|焦點|時事|評論|專欄/i.test(value)) return "公開文章索引";
  if (/試閱|試讀|download|pdf/i.test(value)) return "公開試閱索引";
  return "元照公開資源索引";
}

type DiscoveredItem = { title: string; url: string; summary: string; depth: number; parentTitle: string; kind: "entry" | "detail" };

function discoverLinks(html: string, base: string, source: SourceKey, limit = 20, depth = 1, parentTitle = ""): DiscoveredItem[] {
  const seen = new Set<string>();
  const rows: Array<{ title: string; url: string; summary: string }> = [];
  const matches = html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of matches) {
    const title = cleanHtml(match[2]).slice(0, 160);
    if (title.length < 4 || looksCorrupted(title) || /^(更多|more|回首頁|首頁|登入|註冊|上一頁|下一頁)$/i.test(title)) continue;
    let url: URL;
    try { url = new URL(match[1], base); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (!SOURCES[source].hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    const key = `${title}|${url.href}`;
    if (seen.has(key)) continue;
    const relevant = source === "lawdata"
      ? /journal|article|book|course|lecture|news|magazine|download|法學|月旦|元照|期刊|雜誌|文章|專欄|書籍|新書|圖書|講座|研討|課程|影音|試閱|試讀|活動/i.test(`${title} ${url.pathname} ${url.search}`)
      : source === "get"
        ? /book|BKID|司律|律師|司法官|法學|刑法|民法|訴訟|行政法|憲法|商法/i.test(`${title} ${url.pathname} ${url.search}`)
        : /course|audition|試聽|司律|律師|司法官|法學|刑法|民法|訴訟|行政法|憲法|商法/i.test(`${title} ${url.pathname} ${url.search}`);
    if (!relevant) continue;
    seen.add(key);
    rows.push({ title, url: url.href, summary: source === "lawdata" ? angleResourceType(`${title} ${url.pathname} ${url.search}`) : source === "get" ? "公開書籍／目錄索引" : "公開課程／試聽索引", depth, parentTitle, kind: "entry" });
    if (rows.length >= limit) break;
  }
  return rows;
}

function discoverAngleDetails(html: string, pageUrl: string, parentTitle: string, depth = 3): DiscoveredItem[] {
  const details: DiscoveredItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi)) {
    const title = cleanHtml(match[1]).replace(/^第[一二三四五六七八九十\d]+回[：:、\s]*/, "").slice(0, 160);
    if (title.length < 4 || looksCorrupted(title) || /歡迎|說明|地點|客服|想了解更多|近期講座|全部講座/.test(title) || seen.has(title)) continue;
    seen.add(title);
    details.push({ title, url: `${pageUrl}#topic-${details.length + 1}`, summary: `月旦案例課主題｜上層：${parentTitle}`, depth, parentTitle, kind: "detail" });
  }
  return details.slice(0, 20);
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
    items: segments.filter((item: typeof resourceSegments.$inferSelect) => item.resourceId === resource.id).map((item: typeof resourceSegments.$inferSelect) => { let meta: { depth?: number; parentTitle?: string; kind?: string } = {}; try { meta = JSON.parse(item.text || "{}"); } catch {} return { id: item.id, title: item.title, url: item.sourceUrl, summary: item.summary, enabled: item.recommended && item.reviewStatus !== "disabled", indexed: item.reviewStatus === "published", accessType: "公開索引", depth: meta.depth ?? 1, parentTitle: meta.parentTitle ?? "", kind: meta.kind ?? "entry" }; }),
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
    const html = await readHtml(response);
    let discovered = discoverLinks(html, response.url || config.url, source, source === "lawdata" ? 60 : 12);
    if (source === "lawdata") {
      const caseHub: DiscoveredItem = { title: "月旦案例課", url: "https://www.angle.com.tw/event/practical_discuss_order/", summary: "案例研習／講座索引", depth: 1, parentTitle: "", kind: "entry" };
      const firstLayer = Array.from(new Map([caseHub, ...discovered].map((item) => [item.url, item])).values());
      const categoryLinks = firstLayer.filter((item) => item.url === caseHub.url || /期刊|雜誌|文章|專欄|書籍|圖書|講座|研討|課程|影音|試閱|活動/.test(`${item.title}${item.summary}`)).slice(0, 12);
      const nestedPages = await Promise.all(categoryLinks.map(async (item) => {
        try {
          const nestedResponse = await fetch(item.url, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
          if (!nestedResponse.ok) return { links: [] as DiscoveredItem[], details: [] as DiscoveredItem[] };
          const nestedHtml = await readHtml(nestedResponse);
          return { links: discoverLinks(nestedHtml, nestedResponse.url || item.url, source, 30, 2, item.title), details: discoverAngleDetails(nestedHtml, nestedResponse.url || item.url, item.title, 2) };
        } catch { return { links: [] as DiscoveredItem[], details: [] as DiscoveredItem[] }; }
      }));
      const lecturePages = nestedPages.flatMap((page) => page.links).filter((item) => /practical_(?:example_)?discuss_order/i.test(item.url)).slice(0, 24);
      const thirdLayer = await Promise.all(lecturePages.map(async (item) => {
        try {
          const detailResponse = await fetch(item.url, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
          if (!detailResponse.ok) return [];
          return discoverAngleDetails(await readHtml(detailResponse), detailResponse.url || item.url, item.title, 3);
        } catch { return []; }
      }));
      const unique = new Map(firstLayer.concat(...nestedPages.flatMap((page) => [page.links, page.details]), ...thirdLayer).map((item) => [item.url, item]));
      discovered = Array.from(unique.values()).slice(0, 180);
    }
    if (!discovered.length) throw new Error("頁面已讀取，但目前沒有辨識到可用的公開索引");
    const [existing] = await auth.db.select().from(learningResources).where(and(eq(learningResources.resourceType, "external_index"), eq(learningResources.creator, source))).limit(1);
    const resource = existing ?? (await auth.db.insert(learningResources).values({ resourceType: "external_index", title: config.label, creator: source, subject: "綜合", description: "Demo 公開索引；不含付費全文", sourceUrl: config.url, accessType: "public_index", status: "active", sortOrder: Object.keys(SOURCES).indexOf(source) }).returning())[0];
    const current = await auth.db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, resource.id), eq(resourceSegments.segmentType, "external_catalog")));
    const disabledUrls = new Set(current.filter((item) => item.reviewStatus === "disabled").map((item) => item.sourceUrl).filter(Boolean));
    await auth.db.delete(resourceSegments).where(and(eq(resourceSegments.resourceId, resource.id), eq(resourceSegments.segmentType, "external_catalog")));
    for (let index = 0; index < discovered.length; index++) {
      const item = discovered[index];
      const disabled = disabledUrls.has(item.url);
      const values = { lessonLabel: config.label, title: item.title, sourceUrl: item.url, text: JSON.stringify({ source, accessType: "public_index", depth: item.depth, parentTitle: item.parentTitle, kind: item.kind }), summary: item.summary, importance: 3, reviewStatus: disabled ? "disabled" : "published", recommended: !disabled, sequence: index + 1 };
      await auth.db.insert(resourceSegments).values({ resourceId: resource.id, segmentType: "external_catalog", ...values });
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

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { source?: SourceKey };
  const source = body.source;
  if (!source || !(source in SOURCES)) return Response.json({ error: "未知的同步來源" }, { status: 400 });

  const [resource] = await auth.db.select().from(learningResources).where(and(
    eq(learningResources.resourceType, "external_index"),
    eq(learningResources.creator, source),
  )).limit(1);
  if (!resource) return Response.json({ ok: true, deleted: 0, sources: await sourceRows(auth.db) });

  const current = await auth.db.select({ id: resourceSegments.id }).from(resourceSegments).where(and(
    eq(resourceSegments.resourceId, resource.id),
    eq(resourceSegments.segmentType, "external_catalog"),
  ));
  await auth.db.delete(resourceSegments).where(and(
    eq(resourceSegments.resourceId, resource.id),
    eq(resourceSegments.segmentType, "external_catalog"),
  ));
  await auth.db.delete(learningResources).where(eq(learningResources.id, resource.id));
  return Response.json({ ok: true, deleted: current.length, sources: await sourceRows(auth.db) });
}
