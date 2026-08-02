import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function fetchBig5(url: string) {
  const response = await fetch(url, { headers: { "user-agent": "SiluMentor/1.0" } });
  if (!response.ok) throw new Error(`來源網站回應 ${response.status}`);
  return new TextDecoder("big5").decode(await response.arrayBuffer());
}

export async function POST(request: Request) {
  const { url } = await request.json() as { url?: string };
  const parsed = new URL(String(url ?? ""));
  if (parsed.hostname !== "www.angle.com.tw" || !parsed.pathname.startsWith("/magazine/")) return Response.json({ error: "目前僅接受元照月旦雜誌網址" }, { status: 400 });
  let detailUrl = parsed.toString();
  let issueFromList = "";
  if (parsed.pathname.endsWith("m_search.asp")) {
    const listHtml = await fetchBig5(parsed.toString());
    const latest = listHtml.match(/href=["']([^"']*m_single\.asp\?BKID=\d+)["'][^>]*>\s*月旦法學教室第\s*(\d+)\s*期/i);
    if (!latest) return Response.json({ error: "歷期頁已讀取，但找不到最新一期連結" }, { status: 422 });
    detailUrl = new URL(latest[1].replaceAll("&amp;", "&"), parsed).toString();
    issueFromList = latest[2];
  }
  const html = await fetchBig5(detailUrl);
  const plain = clean(html);
  const issue = issueFromList || plain.match(/月旦法學教室第\s*(\d+)\s*期/)?.[1] || "";
  if (!issue) return Response.json({ error: "找不到期別資料" }, { status: 422 });
  const publishDate = plain.match(/出刊日[^\d]*(\d{4}[年/]\s*\d{1,2})/)?.[1] ?? "";
  const productCode = plain.match(/書\s*號[^A-Z0-9]*(56HTMYB\d+)/i)?.[1] ?? "";
  const articles = Array.from(html.matchAll(/<li[^>]*>\s*([^<]+?／[^<]+?)\s*<a[^>]+href=["']([^"']+MagazinePre_pdf[^"']+\.pdf)["'][^>]*>\s*試讀/gi)).map((match) => ({ title: clean(match[1]), url: new URL(match[2], detailUrl).toString() }));
  const db = await getDb();
  const title = `月旦法學教室第${issue}期`;
  const existing = await db.select().from(learningResources).where(eq(learningResources.sourceUrl, detailUrl)).limit(1);
  if (existing[0]) return Response.json({ resource: existing[0], imported: false, articles: articles.length, detailUrl });
  const [resource] = await db.insert(learningResources).values({ resourceType: "magazine", title, subject: "綜合", creator: "元照出版公司", description: [productCode, publishDate].filter(Boolean).join(" · "), sourceUrl: detailUrl, accessType: "external", status: "draft" }).returning();
  if (articles.length) await db.insert(resourceSegments).values(articles.map((article, index) => ({ resourceId: resource.id, segmentType: "article", lessonLabel: title, title: article.title.slice(0, 100), text: JSON.stringify(article), sequence: index + 1 })));
  return Response.json({ resource, imported: true, articles: articles.length, detailUrl });
}
