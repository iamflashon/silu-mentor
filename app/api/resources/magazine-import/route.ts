import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments, usageLogs } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function fetchBig5(url: string) {
  const response = await fetch(url, { headers: { "user-agent": "SiluMentor/1.0" } });
  if (!response.ok) throw new Error(`來源網站回應 ${response.status}`);
  return new TextDecoder("big5").decode(await response.arrayBuffer());
}

function outputText(payload: Record<string, unknown>) { for (const item of Array.isArray(payload.output) ? payload.output : []) { const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []; for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text; } return ""; }

async function analyzeTrialPdf(article: { title: string; url: string }) {
  const response = await fetch(article.url, { headers: { "user-agent": "SiluMentor/1.0" } });
  if (!response.ok) throw new Error(`PDF 回應 ${response.status}`); const bytes = await response.arrayBuffer(); if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("試讀 PDF 超過 12MB");
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5.6-luna", instructions: "你是台灣司律考試期刊編輯。只能整理公開試讀PDF可見內容，不得補造全文。擷取作者、正文、問題或案例、爭點、法條與試讀範圍；text保留可供AI檢索的完整可見文字，summary以繁中80到160字整理考試價值。不得使用Markdown星號。", input: [{ role: "user", content: [{ type: "input_file", filename: article.url.split("/").pop() || "trial.pdf", file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}` }, { type: "input_text", text: `文章：${article.title}\n請整理這份公開試讀內容。` }] }], text: { format: { type: "json_schema", name: "magazine_trial", strict: true, schema: { type: "object", additionalProperties: false, properties: { author: { type: "string" }, text: { type: "string" }, summary: { type: "string" }, legalTopics: { type: "array", items: { type: "string" } } }, required: ["author", "text", "summary", "legalTopics"] } } } }) });
  const parsed = JSON.parse(outputText(payload)) as { author: string; text: string; summary: string; legalTopics: string[] }; const usage = payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
  return { ...parsed, model: String(payload.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna"), usage };
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
  const [resource] = existing.length ? existing : await db.insert(learningResources).values({ resourceType: "magazine", title, subject: "綜合", creator: "元照出版公司", description: [productCode, publishDate].filter(Boolean).join(" · "), sourceUrl: detailUrl, accessType: "external", status: "draft" }).returning();
  const current = await db.select().from(resourceSegments).where(eq(resourceSegments.resourceId, resource.id)); let indexed = 0; const failures: string[] = [];
  for (let index = 0; index < articles.length; index++) { const article = articles[index]; const row = current.find((item) => item.title === article.title.slice(0, 100)); try { const analyzed = await analyzeTrialPdf(article); const values = { segmentType: "article_trial", lessonLabel: title, title: article.title.slice(0, 100), text: analyzed.text, summary: analyzed.summary, importance: 4, recommended: true, reviewStatus: "ai_reviewed", sequence: index + 1 }; if (row) await db.update(resourceSegments).set(values).where(eq(resourceSegments.id, row.id)); else await db.insert(resourceSegments).values({ resourceId: resource.id, ...values }); await db.insert(usageLogs).values({ model: analyzed.model, source: "月旦試讀PDF", inputTokens: analyzed.usage?.input_tokens ?? 0, cachedTokens: analyzed.usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: analyzed.usage?.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 }); indexed++; } catch (error) { failures.push(`${article.title}：${error instanceof Error ? error.message : "處理失敗"}`); if (!row) await db.insert(resourceSegments).values({ resourceId: resource.id, segmentType: "article_link", lessonLabel: title, title: article.title.slice(0, 100), text: JSON.stringify({ ...article, status: "failed" }), reviewStatus: "failed", sequence: index + 1 }); } }
  await db.update(learningResources).set({ status: indexed ? "active" : "draft", updatedAt: new Date() }).where(eq(learningResources.id, resource.id));
  return Response.json({ resource: { ...resource, status: indexed ? "active" : "draft" }, imported: !existing.length, articles: articles.length, indexed, failures, detailUrl });
}
