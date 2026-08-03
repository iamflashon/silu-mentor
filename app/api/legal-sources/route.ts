import { asc, eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { getDb } from "../../../db";
import { legalArticles, legalDataSources, legalDocuments } from "../../../db/schema";

const seeds = [
  { sourceKey: "moj-regulations", label: "全國法規", category: "法律／命令", sourceUrl: "https://sendlaw.moj.gov.tw/PublicData/GetFile.ashx?AuData=CF&DType=XML" },
  { sourceKey: "constitutional-court", label: "憲法法庭判決", category: "憲法裁判", sourceUrl: "https://cons.judicial.gov.tw/docdata.aspx?fid=38" },
  { sourceKey: "constitutional-interpretations", label: "大法官解釋", category: "大法官解釋", sourceUrl: "https://cons.judicial.gov.tw/jcc/zh-tw/jep03" },
] as const;

async function seedSources() {
  const db = await getDb();
  for (const seed of seeds) await db.insert(legalDataSources).values(seed).onConflictDoNothing();
  return db;
}

function text(value: unknown) { return value == null ? "" : typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function pick(record: Record<string, unknown>, names: string[]) { for (const name of names) { const value = text(record[name]); if (value) return value; } return ""; }
export function collectLawObjects(value: unknown, rows: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) for (const item of value) collectLawObjects(item, rows);
  else if (value && typeof value === "object") { const record = value as Record<string, unknown>; if (pick(record, ["LawName", "法規名稱"]) && (record.LawArticles || record.Articles || record.條文)) rows.push(record); else for (const child of Object.values(record)) collectLawObjects(child, rows); }
  return rows;
}
export function collectArticles(value: unknown, rows: Array<{ no: string; hierarchy: string; content: string }> = []) {
  if (Array.isArray(value)) for (const item of value) collectArticles(item, rows);
  else if (value && typeof value === "object") { const record = value as Record<string, unknown>; const content = pick(record, ["ArticleContent", "Content", "條文內容", "條文"]); const no = pick(record, ["ArticleNo", "ArticleNumber", "條號"]); if (content && (no || /第.+條/.test(content))) rows.push({ no: no || content.match(/第.+?條/)?.[0] || "", hierarchy: pick(record, ["ArticleKind", "Chapter", "編章節"]), content }); else for (const child of Object.values(record)) collectArticles(child, rows); }
  return rows;
}
function decodeArchive(bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { const files = unzipSync(bytes); return Object.entries(files).filter(([name]) => /\.xml$/i.test(name)).map(([, data]) => new TextDecoder("utf-8").decode(data)).join("\n"); }
  return new TextDecoder("utf-8").decode(bytes);
}

type LegalArchiveEntry = { record: Record<string, unknown>; category: "法律" | "命令" };

function parseLegalArchive(bytes: Uint8Array, sourceKey?: string): LegalArchiveEntry[] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const jsonEntries = Object.entries(files).filter(([name]) => {
      if (!/\.json$/i.test(name)) return false;
      if (sourceKey === "moj-regulations") return /(^|\/)(ChLaw|ChOrder)\.json$/i.test(name);
      return true;
    });
    if (jsonEntries.length) {
      const rows: LegalArchiveEntry[] = [];
      for (const [name, data] of jsonEntries) {
        const raw = new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, "");
        const records: Record<string, unknown>[] = [];
        collectLawObjects(JSON.parse(raw), records);
        const category = /(^|\/)ChOrder\.json$/i.test(name) ? "命令" : "法律";
        rows.push(...records.map((record) => ({ record, category })));
      }
      return rows;
    }
  }
  return collectLawObjects(new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(decodeArchive(bytes))).map((record) => ({ record, category: "法律" }));
}

export async function GET() {
  const db = await seedSources();
  const allSources = await db.select().from(legalDataSources).orderBy(asc(legalDataSources.id));
  for (const source of allSources) if (["downloading", "importing"].includes(source.status) && Date.now() - new Date(source.updatedAt).getTime() > 3 * 60 * 1000) await db.update(legalDataSources).set({ status: "failed", lastError: "上次處理逾時，請按「重新下載」續傳", updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
  const visibleKeys = new Set(seeds.map((seed) => seed.sourceKey));
  const sources = allSources.filter((source) => visibleKeys.has(source.sourceKey));
  const withCounts = await Promise.all(sources.map(async (source) => {
    const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, source.sourceKey)).groupBy(legalDocuments.category);
    return { ...source, categoryCounts: Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)])) };
  }));
  return Response.json({ sources: withCounts });
}

export async function POST(request: Request) {
  const body = await request.json() as { sourceKey?: string; restart?: boolean }; const sourceKey = String(body.sourceKey ?? ""); const db = await seedSources(); const [source] = await db.select().from(legalDataSources).where(eq(legalDataSources.sourceKey, sourceKey)).limit(1);
  if (!source) return Response.json({ error: "找不到資料來源" }, { status: 404 });
  await db.update(legalDataSources).set({ status: "downloading", lastError: null, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
  try {
    if (sourceKey.startsWith("moj-")) {
      const { env } = await import("cloudflare:workers"); const archive = source.archiveStorageKey && !body.restart ? await env.BUCKET.get(source.archiveStorageKey) : null;
      let bytes: Uint8Array; let key = source.archiveStorageKey;
      if (archive) bytes = new Uint8Array(await archive.arrayBuffer()); else { const response = await fetch(source.sourceUrl, { headers: { "user-agent": "司律備考法規同步/1.0" } }); if (!response.ok) throw new Error(`官方資料下載失敗（${response.status}）`); bytes = new Uint8Array(await response.arrayBuffer()); key = `legal-archives/${sourceKey}-${Date.now()}.zip`; await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: response.headers.get("content-type") || "application/octet-stream" } }); }
      const entries = parseLegalArchive(bytes, sourceKey); const start = body.restart ? 0 : source.importCursor; const batch = entries.slice(start, start + 40); let articleCount = 0;
      for (const entry of batch) { const law = entry.record; const title = pick(law, ["LawName", "法規名稱"]); if (!title) continue; const externalId = `${sourceKey}:${entry.category}:${title}`; const [doc] = await db.insert(legalDocuments).values({ sourceKey, externalId, title, category: entry.category, modifiedDate: pick(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), effectiveDate: pick(law, ["LawEffectiveDate", "EffectiveDate", "生效日期"]), history: pick(law, ["LawHistories", "Histories", "沿革內容"]), sourceUrl: pick(law, ["LawURL", "Url", "法規網址"]) }).onConflictDoUpdate({ target: legalDocuments.externalId, set: { category: entry.category, modifiedDate: pick(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), history: pick(law, ["LawHistories", "Histories", "沿革內容"]), updatedAt: new Date() } }).returning(); await db.delete(legalArticles).where(eq(legalArticles.documentId, doc.id)); const articles = collectArticles(law.LawArticles || law.Articles || law.條文); for (let i = 0; i < articles.length; i += 40) await db.insert(legalArticles).values(articles.slice(i, i + 40).map((item) => ({ documentId: doc.id, articleNo: item.no, hierarchy: item.hierarchy, content: item.content }))); articleCount += articles.length; }
      const next = start + batch.length; const done = next >= entries.length; const [counts] = await db.select({ docs: sql<number>`count(distinct ${legalDocuments.id})`, articles: sql<number>`count(${legalArticles.id})` }).from(legalDocuments).leftJoin(legalArticles, eq(legalDocuments.id, legalArticles.documentId)).where(eq(legalDocuments.sourceKey, sourceKey)); const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey)).groupBy(legalDocuments.category); const categoryCounts = Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)])); await db.update(legalDataSources).set({ status: done ? "ready" : "importing", archiveStorageKey: key, importCursor: done ? 0 : next, totalAvailable: entries.length, documentCount: Number(counts.docs || 0), articleCount: Number(counts.articles || 0), lastDownloadedAt: new Date(), updatedAt: new Date() }).where(eq(legalDataSources.id, source.id)); return Response.json({ sourceKey, status: done ? "ready" : "importing", processed: batch.length, next, total: entries.length, articleCount, categoryCounts });
    }
    const response = await fetch(source.sourceUrl, { headers: { "user-agent": "司律備考憲法資料同步/1.0" } }); if (!response.ok) throw new Error(`憲法資料頁讀取失敗（${response.status}）`); const html = await response.text(); const matches = [...html.matchAll(/href=["']([^"']*docdata\.aspx\?[^"']*id=(\d+)[^"']*)["'][^>]*>([^<]{4,120})/gi)]; let imported = 0;
    for (const match of matches) { const title = match[3].replace(/&[^;]+;/g, " ").trim(); if (!title) continue; const externalId = `${sourceKey}:${match[2]}`; await db.insert(legalDocuments).values({ sourceKey, externalId, title, category: source.category, sourceUrl: new URL(match[1], source.sourceUrl).toString() }).onConflictDoUpdate({ target: legalDocuments.externalId, set: { title, updatedAt: new Date() } }); imported++; }
    const [count] = await db.select({ value: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey)); await db.update(legalDataSources).set({ status: "ready", documentCount: Number(count.value || 0), lastDownloadedAt: new Date(), updatedAt: new Date() }).where(eq(legalDataSources.id, source.id)); return Response.json({ sourceKey, status: "ready", processed: imported });
  } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : "資料同步失敗"; await db.update(legalDataSources).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id)); return Response.json({ error: message }, { status: 502 }); }
}
