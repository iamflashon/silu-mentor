import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments, usageLogs } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";
import { formatMagazineAnalysis } from "../../../../lib/magazine";

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
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5.6-luna", instructions: "你是台灣司律考試期刊編輯。只能整理公開試讀 PDF 可見內容，不得補造全文。輸出必須同時包含摘要與核心爭點，兩者不得混在一起。summary 用 90 至 160 字說明本文處理的事實背景、主要論證與結論方向；issue 第一優先尋找版面中明示『爭點』的標題，忠實擷取該標題下方的完整可見法律問題。不要把文章標題、一般摘要、案例結論或寬泛主題詞當作爭點。只有試讀頁完全沒有『爭點』標題時，才可依文章開頭整理一個具體法律疑問，並將 issueSource 設為 inferred。issue 應保留當事人行為、程序階段、法條與法律判斷分岔。text 保留作者、正文、案例、法條、爭點與試讀範圍的完整可見文字，以供 AI 檢索。不得使用 Markdown 星號。", input: [{ role: "user", content: [{ type: "input_file", filename: article.url.split("/").pop() || "trial.pdf", file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}` }, { type: "input_text", text: `文章：${article.title}\n請先辨識版面中的「爭點」標題並擷取其下方段落，再另寫一段摘要。` }] }], text: { format: { type: "json_schema", name: "magazine_trial", strict: true, schema: { type: "object", additionalProperties: false, properties: { author: { type: "string" }, text: { type: "string" }, summary: { type: "string" }, issue: { type: "string" }, issueSource: { type: "string", enum: ["explicit", "inferred", "missing"] }, legalTopics: { type: "array", items: { type: "string" } } }, required: ["author", "text", "summary", "issue", "issueSource", "legalTopics"] } } } }) });
  const parsed = JSON.parse(outputText(payload)) as { author: string; text: string; summary: string; issue: string; issueSource: "explicit" | "inferred" | "missing"; legalTopics: string[] }; const usage = payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
  const issue = parsed.issue.trim();
  if (!issue || parsed.issueSource === "missing") throw new Error("已讀取試讀 PDF，但沒有擷取到明確爭點；請改由後台人工補上");
  const summary = parsed.summary.trim();
  if (!summary) throw new Error("已讀取試讀 PDF，但沒有產生摘要");
  return { ...parsed, summary, issue, analysis: formatMagazineAnalysis(summary, issue), text: `摘要：${summary}\n核心爭點：${issue}\n\n${parsed.text.trim()}`, model: String(payload.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna"), usage };
}

export async function POST(request: Request) {
  const { url, discoverYear } = await request.json() as { url?: string; discoverYear?: number | boolean };
  const parsed = new URL(String(url ?? ""));
  if (parsed.hostname !== "www.angle.com.tw" || !parsed.pathname.startsWith("/magazine/")) return Response.json({ error: "目前僅接受元照月旦雜誌網址" }, { status: 400 });
  if (discoverYear) {
    if (!parsed.pathname.endsWith("m_search.asp")) return Response.json({ error: "同步全年請使用月旦法學教室歷期網址" }, { status: 422 });
    const listHtml = await fetchBig5(parsed.toString());
    const candidates = Array.from(listHtml.matchAll(/href=["']([^"']*m_single\.asp\?BKID=\d+)[^"']*["']/gi))
      .map((match) => new URL(match[1].replaceAll("&amp;", "&"), parsed).toString())
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 180);
    const currentYear = typeof discoverYear === "number" && Number.isInteger(discoverYear) ? discoverYear : new Date().getFullYear();
    const issues: Array<{ url: string; title: string; issue: string; publishDate: string }> = [];
    for (const detailUrl of candidates) {
      const detailHtml = await fetchBig5(detailUrl);
      const plain = clean(detailHtml);
      const issue = plain.match(/月旦法學教室第\s*(\d+)\s*期/)?.[1] ?? "";
      const publishDate = plain.match(/出刊日[^\d]*(\d{4})[年/]\s*(\d{1,2})/) ?? null;
      if (!publishDate || !issue) continue;
      const year = Number(publishDate[1]);
      if (year < currentYear && issues.length) break;
      if (year === currentYear) issues.push({ url: detailUrl, title: `月旦法學教室第${issue}期`, issue, publishDate: `${publishDate[1]}/${publishDate[2]}` });
    }
    return Response.json({ year: currentYear, issues });
  }
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
  for (let index = 0; index < articles.length; index++) { const article = articles[index]; const row = current.find((item) => item.title === article.title.slice(0, 100)); try { const analyzed = await analyzeTrialPdf(article); const values = { segmentType: "article_trial", lessonLabel: title, title: article.title.slice(0, 100), text: analyzed.text, summary: analyzed.analysis, importance: 5, recommended: true, reviewStatus: "ai_reviewed", sequence: index + 1 }; if (row) await db.update(resourceSegments).set(values).where(eq(resourceSegments.id, row.id)); else await db.insert(resourceSegments).values({ resourceId: resource.id, ...values }); await db.insert(usageLogs).values({ model: analyzed.model, source: "月旦試讀PDF", inputTokens: analyzed.usage?.input_tokens ?? 0, cachedTokens: analyzed.usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: analyzed.usage?.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 }); indexed++; } catch (error) { const failureMessage = error instanceof Error ? error.message : "處理失敗"; failures.push(`${article.title}：${failureMessage}`); const values = { segmentType: "article_link", lessonLabel: title, title: article.title.slice(0, 100), text: JSON.stringify({ ...article, status: "failed", error: failureMessage }), summary: "", importance: 0, recommended: false, reviewStatus: "failed", sequence: index + 1 }; if (row) await db.update(resourceSegments).set(values).where(eq(resourceSegments.id, row.id)); else await db.insert(resourceSegments).values({ resourceId: resource.id, ...values }); } }
  await db.update(learningResources).set({ status: indexed ? "active" : "draft", updatedAt: new Date() }).where(eq(learningResources.id, resource.id));
  return Response.json({ resource: { ...resource, status: indexed ? "active" : "draft" }, imported: !existing.length, articles: articles.length, indexed, failures, detailUrl });
}
