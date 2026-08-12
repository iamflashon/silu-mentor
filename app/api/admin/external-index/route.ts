import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const SOURCES = {
  lawdata: { label: "元照／月旦全站資源", url: "https://www.angle.com.tw/", hosts: ["angle.com.tw", "www.angle.com.tw", "lawdata.com.tw", "www.lawdata.com.tw"] },
  get: { label: "高點文化", url: "https://publish.get.com.tw/", hosts: ["publish.get.com.tw"] },
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

type DiscoveredItem = { title: string; url: string; summary: string; depth: number; parentTitle: string; kind: "entry" | "detail"; subject?: string; teacher?: string };

const LEGAL_SUBJECTS = ["憲法", "行政法", "刑法", "刑事訴訟法", "刑訴", "民法", "民事訴訟法", "民訴", "商事法", "公司法", "證券交易法", "保險法", "票據法", "法律倫理", "國際公法", "國際私法"];

function discoverIbrainTeachers(html: string, pageUrl: string, parentTitle: string, depth: number): DiscoveredItem[] {
  const rows: DiscoveredItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*(?:ListDetail|Teacher|Lecturer|Course)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = cleanHtml(match[2]).slice(0, 160);
    if (title.length < 2 || looksCorrupted(title)) continue;
    let url: URL;
    try { url = new URL(match[1], pageUrl); } catch { continue; }
    if (!SOURCES.ibrain.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    const contextStart = Math.max(0, (match.index ?? 0) - 500);
    const contextEnd = Math.min(html.length, (match.index ?? 0) + match[0].length + 500);
    const context = cleanHtml(html.slice(contextStart, contextEnd));
    const subject = LEGAL_SUBJECTS.find((name) => context.includes(name)) || "司律綜合";
    const teacherMatch = context.match(/(?:師資|老師|講師)[：:\s]*([\u3400-\u9fff·]{2,8})/u);
    const teacher = teacherMatch?.[1] || (/^[\u3400-\u9fff·]{2,8}(?:老師|師)$/u.test(title) ? title.replace(/老師|師$/u, "") : "");
    const key = `${url.href}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, url: url.href, summary: `${subject}${teacher ? `｜師資：${teacher}` : ""}｜公開課程／試聽索引`, depth, parentTitle, kind: "detail", subject, teacher });
  }
  return rows.slice(0, 60);
}

function discoverLinks(html: string, base: string, source: SourceKey, limit = 20, depth = 1, parentTitle = ""): DiscoveredItem[] {
  const seen = new Set<string>();
  const rows: DiscoveredItem[] = [];
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
        ? /book|course|lecture|article|BKID|圖書分類總覽|雲端微課群|波斯納讀書會|考前直播間|解讀大師文章|司律|律師|司法官|法學|刑法|民法|訴訟|行政法|憲法|商法/i.test(`${title} ${url.pathname} ${url.search}`)
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

function discoverAngleMagazineContents(html: string, pageUrl: string, parentTitle: string, depth: number): DiscoveredItem[] {
  if (!/\/magazine\/m_single\.asp|[?&]BKID=/i.test(pageUrl)) return [];
  const rows: DiscoveredItem[] = [];
  const seen = new Set<string>();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const attributes = match[1] || "";
    const title = cleanHtml(match[2]).replace(/^(?:試閱|試讀|全文|閱讀)\s*[：:、-]?\s*/u, "").slice(0, 160);
    if (title.length < 4 || looksCorrupted(title) || /^(?:回首頁|首頁|訂閱|登入|註冊|購物車|上一頁|下一頁|更多)$/u.test(title)) continue;
    const href = attributes.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
      ?? attributes.match(/(?:window\.open|location(?:\.href)?)\s*\(?\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^javascript:\s*(?:void|;)$/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href.replace(/^javascript:\s*(?:window\.)?open\s*\(\s*["']|["']\s*\).*$/gi, ""), pageUrl); } catch { continue; }
    if (!SOURCES.lawdata.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
    const canonical = canonicalUrl(url.href);
    if (canonical === canonicalUrl(pageUrl) || seen.has(canonical)) continue;
    const context = cleanHtml(html.slice(Math.max(0, (match.index ?? 0) - 320), Math.min(html.length, (match.index ?? 0) + match[0].length + 320)));
    const contentLike = /article|content|detail|preview|download|\.pdf|試閱|試讀|摘要|作者|頁碼|DOI|篇名|論著|裁判|法學/i.test(`${canonical} ${title} ${context}`);
    if (!contentLike) continue;
    const author = context.match(/(?:作者|文／|撰文)[：:\s]*([\u3400-\u9fffA-Za-z·．、，,\s]{2,40})/u)?.[1]?.trim().slice(0, 40);
    rows.push({
      title,
      url: canonical,
      summary: `期刊文章目錄${author ? `｜作者：${author}` : ""}｜上層：${parentTitle}`,
      depth,
      parentTitle,
      kind: "entry",
    });
    seen.add(canonical);
  }

  // Angle's magazine pages often render the article title as plain text and
  // attach URLs only to the neighbouring 試讀／書籍／影音 badges.  Link-only
  // discovery therefore misses the complete visible table of contents.
  const contentStart = html.search(/本期內容|本期試讀/i);
  const catalogHtml = contentStart >= 0 ? html.slice(contentStart, contentStart + 180_000) : html;
  // Avoid matching container <div>s: a non-recursive regex would otherwise
  // consume the inner list rows before they can be inspected individually.
  const blocks = catalogHtml.matchAll(/<(li|p|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi);
  let section = "本期內容";
  let syntheticIndex = 0;
  for (const match of blocks) {
    const blockHtml = match[2] || "";
    const blockText = cleanHtml(blockHtml)
      .replace(/(?:試閱|試讀|書籍|影音|下載|購買)\s*/gu, " ")
      .replace(/^[·•．。\-—–◎]+\s*/u, "")
      .replace(/\s+/g, " ")
      .trim();
    const sectionMatch = blockText.match(/^【([^】]{2,30})】$/u);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (blockText.length < 6 || blockText.length > 220 || looksCorrupted(blockText)) continue;
    if (/^(?:本期內容|雜誌介紹|定期|訂閱方案|放入購物車|出版單位|出版日|定價|特價|書號)/u.test(blockText)) continue;
    if (!/[\u3400-\u9fff]/u.test(blockText)) continue;

    const parts = blockText.split(/\s*[／/]\s*/u);
    const title = (parts[0] || "").replace(/^【[^】]+】\s*/u, "").trim().slice(0, 160);
    if (title.length < 6 || /^(?:作者|目錄|更多|關於|客服|會員)/u.test(title)) continue;
    const author = (parts[1] || "").match(/^[\u3400-\u9fffA-Za-z·．、，,\s]{2,40}/u)?.[0]?.trim();

    const badgeLinks = Array.from(blockHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi));
    let publicUrl = "";
    for (const badge of badgeLinks) {
      const label = cleanHtml(badge[2]);
      if (!/試閱|試讀|書籍|影音|下載/u.test(label)) continue;
      const href = (badge[1] || "").match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      try {
        const candidate = new URL(href, pageUrl);
        if (SOURCES.lawdata.hosts.some((host) => candidate.hostname === host || candidate.hostname.endsWith(`.${host}`))) {
          publicUrl = canonicalUrl(candidate.href);
          break;
        }
      } catch {}
    }

    const identity = `${section}|${title}|${author || ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    syntheticIndex += 1;
    rows.push({
      title,
      url: publicUrl || `${canonicalUrl(pageUrl)}&catalog_item=${syntheticIndex}`,
      summary: `本期目錄｜分類：${section}${author ? `｜作者：${author}` : ""}｜上層：${parentTitle}`,
      depth,
      parentTitle,
      kind: "detail",
    });
  }
  return rows.slice(0, 80);
}

function isAngleRootSection(item: DiscoveredItem) {
  const value = `${item.title} ${item.url}`;
  if (/[?&](?:BKID|AID|PID|no|id)=/i.test(item.url) || /m_single|article[_/-]?(?:view|detail)|news[_/-]?(?:view|detail)/i.test(item.url)) return false;
  if (/第\s*\d+\s*期|最高法院|高等法院|地方法院|民事判決|刑事判決|行政判決/i.test(item.title)) return false;
  return /^(?:月旦|元照|研討|講座|課程|期刊|雜誌|書籍|新書|法學)(?:知識庫|書屋|案例課|學院|講堂|教室|期刊|雜誌|專區|中心|活動|研討|講座|課程|新書|出版|網路書店)?/i.test(value);
}

function isGetRootSection(item: DiscoveredItem) {
  if (/[?&](?:BKID|bookid|id)=/i.test(item.url) || /detail|single|product/i.test(item.url)) return false;
  return /^(?:圖書分類(?:總覽|速覽)|雲端微課群|波斯納讀書會|考前直播間|解讀大師文章)$/u.test(item.title.trim());
}

function isIbrainRootSection(item: DiscoveredItem) {
  if (/[?&](?:courseid|id)=/i.test(item.url) || /detail|single/i.test(item.url)) return false;
  return /(?:課程分類|課程總覽|試聽|司律|律師|司法官|法學)/u.test(item.title) && item.title.length <= 24;
}

const AUTO_CRAWL_LIMITS: Record<SourceKey, { maxDepth: number; maxPages: number; maxItems: number }> = {
  lawdata: { maxDepth: 10, maxPages: 180, maxItems: 1600 },
  get: { maxDepth: 7, maxPages: 56, maxItems: 480 },
  ibrain: { maxDepth: 6, maxPages: 42, maxItems: 360 },
};

function crawlPriority(source: SourceKey, item: DiscoveredItem) {
  if (source !== "lawdata") return item.depth * 100;
  const value = `${item.title} ${item.url}`;
  // The useful magazine catalogue is behind the issue page.  Process these
  // before generic navigation/search links so a broad site crawl cannot spend
  // the entire page and item budget before reaching 本期內容.
  if (/\/magazine\/m_single\.asp|[?&]BKID=/i.test(item.url)) return item.depth * 10;
  if (/\/magazine\/m_search\.asp|[?&]KindID=/i.test(item.url)) return item.depth * 10 + 1;
  if (/月旦法學教室|月旦法學雜誌|裁判時報|實務選評|律評|財經法/i.test(value)) return item.depth * 10 + 2;
  if (/search\.asp|\/media\/|作者|書籍|影音/i.test(value)) return 10_000 + item.depth;
  return 1_000 + item.depth;
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].filter((key) => /^utm_|^(?:fbclid|gclid)$/i.test(key)).forEach((key) => url.searchParams.delete(key));
    return url.href.replace(/\/$/, "");
  } catch { return value; }
}

async function crawlHierarchy(source: SourceKey, roots: DiscoveredItem[]) {
  const limits = AUTO_CRAWL_LIMITS[source];
  const output = new Map<string, DiscoveredItem>();
  const visited = new Set<string>();
  const queue = roots.map((item) => ({ ...item, url: canonicalUrl(item.url) }));
  queue.forEach((item) => output.set(item.url, item));
  let pagesRead = 0;

  while (queue.length && pagesRead < limits.maxPages && output.size < limits.maxItems) {
    queue.sort((left, right) => crawlPriority(source, left) - crawlPriority(source, right));
    const batch = queue.splice(0, Math.min(4, limits.maxPages - pagesRead));
    const results = await Promise.all(batch.map(async (parent) => {
      const key = canonicalUrl(parent.url);
      // A real detail URL can still contain an article list, author page or public
      // preview. Only synthetic in-page headings are guaranteed leaf nodes.
      if (visited.has(key) || parent.depth >= limits.maxDepth || /#topic-\d+$/i.test(parent.url)) return [] as DiscoveredItem[];
      visited.add(key);
      try {
        const response = await fetch(parent.url, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
        if (!response.ok) return [];
        const html = await readHtml(response);
        const nextDepth = parent.depth + 1;
        const links = discoverLinks(html, response.url || parent.url, source, 60, nextDepth, parent.title);
        const details = source === "lawdata"
          ? [
              ...discoverAngleMagazineContents(html, response.url || parent.url, parent.title, nextDepth),
              ...discoverAngleDetails(html, response.url || parent.url, parent.title, nextDepth),
            ]
          : source === "ibrain"
            ? discoverIbrainTeachers(html, response.url || parent.url, parent.title, nextDepth)
            : [];
        return Array.from(new Map([...links, ...details].map((item) => [canonicalUrl(item.url), { ...item, url: canonicalUrl(item.url) }])).values());
      } catch { return []; }
    }));
    pagesRead += batch.length;
    for (const child of results.flat()) {
      if (output.size >= limits.maxItems || output.has(child.url)) continue;
      output.set(child.url, child);
      if (child.kind !== "detail" && child.depth < limits.maxDepth) queue.push(child);
    }
  }
  return { items: Array.from(output.values()), pagesRead, truncated: queue.length > 0 || output.size >= limits.maxItems };
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
    items: segments.filter((item: typeof resourceSegments.$inferSelect) => item.resourceId === resource.id).map((item: typeof resourceSegments.$inferSelect) => { let meta: { depth?: number; parentTitle?: string; kind?: string; subject?: string; teacher?: string } = {}; try { meta = JSON.parse(item.text || "{}"); } catch {} return { id: item.id, title: item.title, url: item.sourceUrl, summary: item.summary, enabled: item.recommended && item.reviewStatus !== "disabled", indexed: item.reviewStatus === "published", accessType: "公開索引", depth: meta.depth ?? 1, parentTitle: meta.parentTitle ?? "", kind: meta.kind ?? "entry", subject: meta.subject ?? "", teacher: meta.teacher ?? "" }; }),
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
  const body = await request.json() as { source?: SourceKey; itemId?: number };
  const source = body.source;
  if (!source || !(source in SOURCES)) return Response.json({ error: "未知的同步來源" }, { status: 400 });
  const config = SOURCES[source];
  try {
    if (Number.isInteger(body.itemId)) {
      const [item] = await auth.db.select().from(resourceSegments).where(and(
        eq(resourceSegments.id, Number(body.itemId)),
        eq(resourceSegments.segmentType, "external_catalog"),
      )).limit(1);
      if (!item) return Response.json({ error: "找不到要深入抓取的資料" }, { status: 404 });
      const [resource] = await auth.db.select().from(learningResources).where(and(
        eq(learningResources.id, item.resourceId),
        eq(learningResources.resourceType, "external_index"),
        eq(learningResources.creator, source),
      )).limit(1);
      if (!resource || !item.sourceUrl) return Response.json({ error: "這筆資料沒有可抓取的公開來源頁面" }, { status: 400 });

      let itemMeta: { depth?: number } = {};
      try { itemMeta = JSON.parse(item.text || "{}"); } catch {}
      const response = await fetch(item.sourceUrl, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
      if (!response.ok) throw new Error(`內層頁面回應 ${response.status}`);
      const html = await readHtml(response);
      const nextDepth = Math.min((itemMeta.depth ?? 1) + 1, AUTO_CRAWL_LIMITS[source].maxDepth);
      const links = discoverLinks(html, response.url || item.sourceUrl, source, 40, nextDepth, item.title);
      const details = source === "lawdata"
        ? [
            ...discoverAngleMagazineContents(html, response.url || item.sourceUrl, item.title, nextDepth),
            ...discoverAngleDetails(html, response.url || item.sourceUrl, item.title, nextDepth),
          ]
        : source === "ibrain" ? discoverIbrainTeachers(html, response.url || item.sourceUrl, item.title, nextDepth) : [];
      const discovered = Array.from(new Map([...links, ...details].map((child) => [child.url, child])).values())
        .filter((child) => child.url !== item.sourceUrl)
        .sort((left, right) => crawlPriority(source, left) - crawlPriority(source, right))
        .slice(0, source === "lawdata" ? 120 : 40);
      if (!discovered.length) throw new Error("已讀取此頁，但沒有辨識到可建立索引的下一層公開資料");

      const current = await auth.db.select().from(resourceSegments).where(and(
        eq(resourceSegments.resourceId, resource.id),
        eq(resourceSegments.segmentType, "external_catalog"),
      ));
      const existingUrls = new Set(current.map((row) => row.sourceUrl).filter(Boolean));
      let added = 0;
      let sequence = current.reduce((maximum, row) => Math.max(maximum, row.sequence ?? 0), 0);
      for (const child of discovered) {
        if (existingUrls.has(child.url)) continue;
        sequence += 1;
        await auth.db.insert(resourceSegments).values({
          resourceId: resource.id,
          segmentType: "external_catalog",
          lessonLabel: config.label,
          title: child.title,
          sourceUrl: child.url,
          text: JSON.stringify({ source, accessType: "public_index", depth: child.depth, parentTitle: child.parentTitle, kind: child.kind, subject: child.subject, teacher: child.teacher }),
          summary: child.summary,
          importance: 3,
          reviewStatus: "published",
          recommended: true,
          sequence,
        });
        existingUrls.add(child.url);
        added += 1;
      }
      await auth.db.update(learningResources).set({ updatedAt: new Date() }).where(eq(learningResources.id, resource.id));
      return Response.json({ source, discovered: discovered.length, added, parentTitle: item.title, sources: await sourceRows(auth.db) });
    }

    const response = await fetch(config.url, { headers: { "user-agent": "iBrain-SiluMentor-Demo/1.0", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!response.ok) throw new Error(`來源網站回應 ${response.status}`);
    const html = await readHtml(response);
    let discovered = discoverLinks(html, response.url || config.url, source, source === "lawdata" ? 60 : 12);
    if (source === "lawdata") {
      const caseHub: DiscoveredItem = { title: "月旦案例課", url: "https://www.angle.com.tw/event/practical_discuss_order/", summary: "案例研習／講座索引", depth: 1, parentTitle: "", kind: "entry" };
      const firstLayer = Array.from(new Map([caseHub, ...discovered.filter(isAngleRootSection)].map((item) => [item.url, { ...item, depth: 1, parentTitle: "" }])).values());
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
      const crawled = await crawlHierarchy(source, Array.from(unique.values()).filter((item) => item.depth === 1));
      discovered = Array.from(new Map([...unique.values(), ...crawled.items].map((item) => [canonicalUrl(item.url), { ...item, url: canonicalUrl(item.url) }])).values()).slice(0, AUTO_CRAWL_LIMITS[source].maxItems);
    } else if (source === "get") {
      const roots = discovered.filter(isGetRootSection).map((item) => ({ ...item, depth: 1, parentTitle: "" }));
      discovered = (await crawlHierarchy(source, roots)).items;
    } else if (source === "ibrain") {
      const roots = discovered.filter(isIbrainRootSection).map((item) => ({ ...item, depth: 1, parentTitle: "" }));
      discovered = (await crawlHierarchy(source, roots)).items;
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
      const values = { lessonLabel: config.label, title: item.title, sourceUrl: item.url, text: JSON.stringify({ source, accessType: "public_index", depth: item.depth, parentTitle: item.parentTitle, kind: item.kind, subject: item.subject, teacher: item.teacher }), summary: item.summary, importance: 3, reviewStatus: disabled ? "disabled" : "published", recommended: !disabled, sequence: index + 1 };
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
