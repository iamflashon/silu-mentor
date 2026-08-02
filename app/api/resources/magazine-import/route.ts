import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  const { url } = await request.json() as { url?: string };
  const parsed = new URL(String(url ?? ""));
  if (parsed.hostname !== "www.angle.com.tw" || !parsed.pathname.startsWith("/magazine/")) return Response.json({ error: "目前僅接受元照月旦雜誌網址" }, { status: 400 });
  const listHtml = await (await fetch(parsed.toString(), { headers: { "user-agent": "SiluMentor/1.0" } })).text();
  const latest = listHtml.match(/href=["']([^"']*m_single\.asp\?BKID=\d+)["'][^>]*>\s*月旦法學教室第\s*(\d+)\s*期/i);
  if (!latest) return Response.json({ error: "找不到最新期資料，請改貼單期網址" }, { status: 422 });
  const detailUrl = new URL(latest[1].replaceAll("&amp;", "&"), parsed).toString();
  const html = await (await fetch(detailUrl, { headers: { "user-agent": "SiluMentor/1.0" } })).text();
  const plain = clean(html);
  const issue = latest[2];
  const publishDate = plain.match(/出刊日[^\d]*(\d{4}[年/]\s*\d{1,2})/)?.[1] ?? "";
  const productCode = plain.match(/書\s*號[^A-Z0-9]*(56HTMYB\d+)/i)?.[1] ?? "";
  const trialBlock = plain.match(/本期試讀([\s\S]*?)法學教室/)?.[1] ?? "";
  const articles = trialBlock.split(/[．。]/).map((item) => item.trim()).filter((item) => item.length > 8).slice(0, 12);
  const db = await getDb();
  const title = `月旦法學教室第${issue}期`;
  const existing = await db.select().from(learningResources).where(eq(learningResources.sourceUrl, detailUrl)).limit(1);
  if (existing[0]) return Response.json({ resource: existing[0], imported: false, articles: articles.length });
  const [resource] = await db.insert(learningResources).values({ resourceType: "magazine", title, subject: "綜合", creator: "元照出版公司", description: [productCode, publishDate].filter(Boolean).join(" · "), sourceUrl: detailUrl, accessType: "external", status: "draft" }).returning();
  if (articles.length) await db.insert(resourceSegments).values(articles.map((text, index) => ({ resourceId: resource.id, segmentType: "article", lessonLabel: title, title: text.slice(0, 100), text, sequence: index + 1 })));
  return Response.json({ resource, imported: true, articles: articles.length });
}
