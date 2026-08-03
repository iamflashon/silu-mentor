import { asc, eq, sql } from "drizzle-orm";
import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { getDb } from "../../../db";
import { legalArticles, legalDataSources, legalDocuments } from "../../../db/schema";
import {
  collectLawObjects,
  compactLegalRecord,
  legalCategory,
  legalClassification,
  legalTitle,
  normalizedArticles,
  pickLegalValue,
  type LegalArchiveEntry,
} from "../../../lib/legal-parser";
import {
  extractConstitutionalContent,
  extractConstitutionalField,
  extractConstitutionalListings,
} from "../../../lib/constitutional-parser";

const seeds = [
  { sourceKey: "moj-regulations", label: "全國法規", category: "法律／命令", sourceUrl: "https://sendlaw.moj.gov.tw/PublicData/GetFile.ashx?AuData=CF&DType=XML" },
  { sourceKey: "constitutional-court", label: "憲法法庭判決", category: "憲法裁判", sourceUrl: "https://cons.judicial.gov.tw/judcurrentNew1.aspx?fid=38" },
  { sourceKey: "constitutional-interpretations", label: "大法官解釋", category: "大法官解釋", sourceUrl: "https://cons.judicial.gov.tw/judcurrent.aspx?fid=2195" },
] as const;

async function seedSources() {
  const db = await getDb();
  for (const seed of seeds) await db.insert(legalDataSources).values(seed).onConflictDoUpdate({ target: legalDataSources.sourceKey, set: { label: seed.label, category: seed.category, sourceUrl: seed.sourceUrl } });
  return db;
}

async function insertArticles(db: Awaited<ReturnType<typeof getDb>>, documentId: number, value: unknown) {
  const articles = normalizedArticles(value);
  for (let index = 0; index < articles.length; index += 8) {
    await db.insert(legalArticles).values(articles.slice(index, index + 8).map((item) => ({ documentId, ...item, updatedAt: new Date() })));
  }
  return articles.length;
}
function decodeArchive(bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { const files = unzipSync(bytes); return Object.entries(files).filter(([name]) => /\.xml$/i.test(name)).map(([, data]) => new TextDecoder("utf-8").decode(data)).join("\n"); }
  return new TextDecoder("utf-8").decode(bytes);
}

// Keep the expensive ZIP decompression out of every import batch.  The first
// batch prepares small JSON objects in R2; later requests read only the batch
// they need.  This is important for large MOJ archives because a Worker can
// otherwise time out while repeatedly decompressing the same ZIP.
const legalImportBatchSize = 10;
type PreparedLegalManifest = {
  version: 1;
  batchSize: number;
  total: number;
  batchKeys: string[];
};

function preparedManifestKey(archiveKey: string) {
  return `${archiveKey}.prepared-manifest.json`;
}

function preparedBatchKey(archiveKey: string, index: number) {
  return `${archiveKey}.prepared-batches/${String(index).padStart(5, "0")}.json`;
}

function isMojLawFile(name: string, sourceKey?: string) {
  if (!/\.(json|xml)$/i.test(name)) return false;
  return sourceKey !== "moj-regulations" || /(^|\/)(ChLaw|ChOrder)\.json$/i.test(name) || /\.xml$/i.test(name);
}

function parseLegalArchive(bytes: Uint8Array, sourceKey?: string): LegalArchiveEntry[] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const sourceEntries = Object.entries(files).filter(([name]) => {
      if (!/\.(json|xml)$/i.test(name)) return false;
      if (sourceKey === "moj-regulations") return /(^|\/)(ChLaw|ChOrder)\.json$/i.test(name) || /\.xml$/i.test(name);
      return true;
    });
    if (sourceEntries.length) {
      const rows: LegalArchiveEntry[] = [];
      for (const [name, data] of sourceEntries) {
        const raw = new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, "");
        const records: Record<string, unknown>[] = [];
        if (/\.xml$/i.test(name)) collectLawObjects(new XMLParser({ ignoreAttributes: false, trimValues: true, isArray: (tag) => tag === "法規" || tag === "條文" }).parse(raw), records);
        else collectLawObjects(JSON.parse(raw), records);
        const fallback = /(^|\/)ChOrder\.json$/i.test(name) ? "命令" : "法律";
        rows.push(...records.map((record) => ({ record: compactLegalRecord(record), category: legalCategory(record, fallback) })));
      }
      return rows;
    }
  }
  return collectLawObjects(new XMLParser({ ignoreAttributes: false, trimValues: true, isArray: (name) => name === "法規" || name === "條文" }).parse(decodeArchive(bytes))).map((record) => ({ record: compactLegalRecord(record), category: legalCategory(record) }));
}

/**
 * Parse an R2 ZIP body without materialising the whole archive or every file
 * in it. The previous unzipSync path duplicated a large archive in Worker
 * memory and caused POST /api/legal-sources to be terminated by Cloudflare.
 */
async function prepareLegalZipStream(
  bucket: R2Bucket,
  archiveKey: string,
  body: ReadableStream<Uint8Array>,
  sourceKey: string,
) {
  const batchKeys: string[] = [];
  const pendingWrites: Promise<unknown>[] = [];
  let pendingEntries: LegalArchiveEntry[] = [];
  let total = 0;
  let streamError: Error | null = null;

  const flush = () => {
    if (!pendingEntries.length) return;
    const batch = pendingEntries;
    pendingEntries = [];
    total += batch.length;
    const key = preparedBatchKey(archiveKey, batchKeys.length);
    batchKeys.push(key);
    pendingWrites.push(
      bucket.put(key, JSON.stringify(batch), {
        httpMetadata: { contentType: "application/json" },
      }),
    );
  };

  const unzip = new Unzip((file) => {
    if (!isMojLawFile(file.name, sourceKey)) return;

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    file.ondata = (error, data, final) => {
      try {
        if (error) throw error;
        if (data?.byteLength) {
          chunks.push(data);
          byteLength += data.byteLength;
        }
        if (!final) return;

        const jsonBytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          jsonBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const raw = new TextDecoder("utf-8").decode(jsonBytes).replace(/^\uFEFF/, "");
        const records: Record<string, unknown>[] = [];
        if (/\.xml$/i.test(file.name)) collectLawObjects(new XMLParser({ ignoreAttributes: false, trimValues: true, isArray: (tag) => tag === "法規" || tag === "條文" }).parse(raw), records);
        else collectLawObjects(JSON.parse(raw), records);
        const fallback = /(^|\/)ChOrder\.json$/i.test(file.name) ? "命令" : "法律";
        for (const record of records) {
          pendingEntries.push({ record: compactLegalRecord(record), category: legalCategory(record, fallback) });
          if (pendingEntries.length >= legalImportBatchSize) flush();
        }
      } catch (caught) {
        streamError = caught instanceof Error ? caught : new Error("ZIP 法規資料解析失敗");
      }
    };
    try {
      file.start();
    } catch (caught) {
      streamError = caught instanceof Error ? caught : new Error("ZIP 分段解壓失敗");
    }
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      unzip.push(next.value, false);
    }
    unzip.push(new Uint8Array(0), true);
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw streamError;
  flush();
  await Promise.all(pendingWrites);

  if (!batchKeys.length) throw new Error("ZIP 內沒有找到可辨識的 ChLaw／ChOrder 法規資料");
  return {
    version: 1 as const,
    batchSize: legalImportBatchSize,
    total,
    batchKeys,
  };
}

async function getPreparedManifest(bucket: R2Bucket, archiveKey: string, sourceKey: string) {
  const manifestKey = preparedManifestKey(archiveKey);
  const existing = await bucket.get(manifestKey);
  if (existing) {
    const manifest = JSON.parse(await existing.text()) as PreparedLegalManifest;
    if (manifest.version === 1 && manifest.batchSize > 0 && manifest.total >= 0 && manifest.batchKeys.length > 0) return manifest;
  }

  const archive = await bucket.get(archiveKey);
  if (!archive) throw new Error("找不到已上傳的全國法規 ZIP，請重新上傳");

  const contentType = archive.httpMetadata?.contentType?.toLowerCase() ?? "";
  const looksLikeZip = contentType.includes("zip") ||
    (!contentType.includes("xml") && /\.zip$/i.test(archiveKey));
  if (looksLikeZip && archive.body) {
    const streamed = await prepareLegalZipStream(bucket, archiveKey, archive.body, sourceKey);
    const manifest = streamed;
    await bucket.put(manifestKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
    return manifest;
  }

  const entries = parseLegalArchive(new Uint8Array(await archive.arrayBuffer()), sourceKey);
  if (!entries.length) throw new Error("ZIP 內沒有找到可辨識的法規資料（需要 ChLaw／ChOrder JSON 或官方 XML）");

  const batchKeys: string[] = [];
  for (let start = 0; start < entries.length; start += legalImportBatchSize) {
    const index = batchKeys.length;
    const key = preparedBatchKey(archiveKey, index);
    await bucket.put(key, JSON.stringify(entries.slice(start, start + legalImportBatchSize)), {
      httpMetadata: { contentType: "application/json" },
    });
    batchKeys.push(key);
  }

  const manifest: PreparedLegalManifest = {
    version: 1,
    batchSize: legalImportBatchSize,
    total: entries.length,
    batchKeys,
  };
  await bucket.put(manifestKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
}

async function readPreparedBatch(bucket: R2Bucket, manifest: PreparedLegalManifest, start: number) {
  const batchIndex = Math.floor(start / manifest.batchSize);
  const key = manifest.batchKeys[batchIndex];
  if (!key) return [] as LegalArchiveEntry[];
  const object = await bucket.get(key);
  if (!object) throw new Error("法規匯入批次暫存資料遺失，請重新上傳 ZIP");
  const entries = JSON.parse(await object.text()) as LegalArchiveEntry[];
  return entries.slice(start - batchIndex * manifest.batchSize);
}

export async function GET() {
  try {
    const db = await seedSources();
    const allSources = await db.select().from(legalDataSources).orderBy(asc(legalDataSources.id));
    for (const source of allSources) if (["downloading", "importing"].includes(source.status) && Date.now() - new Date(source.updatedAt).getTime() > 3 * 60 * 1000) await db.update(legalDataSources).set({ status: "failed", lastError: "上次處理逾時，請按「重新下載」續傳", updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
    const visibleKeys = new Set(seeds.map((seed) => seed.sourceKey));
    const sources = allSources.filter((source) => visibleKeys.has(source.sourceKey));
    const withCounts = await Promise.all(sources.map(async (source) => {
      const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, source.sourceKey)).groupBy(legalDocuments.category);
      return { ...source, hasArchive: Boolean(source.archiveStorageKey), archiveStorageKey: undefined, categoryCounts: Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)])) };
    }));
    return Response.json({ sources: withCounts });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "法規資料狀態暫時無法讀取";
    return Response.json({ error: message, sources: [] }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json() as { sourceKey?: string; restart?: boolean; entries?: LegalArchiveEntry[]; cursor?: number; total?: number; final?: boolean }; const sourceKey = String(body.sourceKey ?? ""); const db = await seedSources(); const [source] = await db.select().from(legalDataSources).where(eq(legalDataSources.sourceKey, sourceKey)).limit(1);
  if (!source) return Response.json({ error: "找不到資料來源" }, { status: 404 });
  try {
    if (sourceKey === "moj-regulations" && Array.isArray(body.entries)) {
      const entries = body.entries.slice(0, 20);
      const cursor = Math.max(0, Number(body.cursor) || 0);
      const total = Math.max(entries.length, Number(body.total) || entries.length);
      if (body.restart) await db.delete(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey));
      await db.update(legalDataSources).set({ status: "importing", importCursor: cursor, totalAvailable: total, lastError: null, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
      let articleCount = 0;
      for (const incoming of entries) {
        if (!incoming || typeof incoming !== "object" || !incoming.record || typeof incoming.record !== "object") continue;
        const category: "法律" | "命令" = incoming.category === "命令" ? "命令" : "法律";
        const law = compactLegalRecord(incoming.record);
        const title = legalTitle(law);
        if (!title) continue;
        const externalId = `${sourceKey}:${category}:${title}`;
        const classification = legalClassification(law);
        const [doc] = await db.insert(legalDocuments).values({ sourceKey, externalId, title, category, classification, modifiedDate: pickLegalValue(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), effectiveDate: pickLegalValue(law, ["LawEffectiveDate", "EffectiveDate", "生效日期"]), history: pickLegalValue(law, ["LawHistories", "Histories", "沿革內容"]), sourceUrl: pickLegalValue(law, ["LawURL", "Url", "法規網址"]) }).onConflictDoUpdate({ target: legalDocuments.externalId, set: { category, classification, modifiedDate: pickLegalValue(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), effectiveDate: pickLegalValue(law, ["LawEffectiveDate", "EffectiveDate", "生效日期"]), history: pickLegalValue(law, ["LawHistories", "Histories", "沿革內容"]), sourceUrl: pickLegalValue(law, ["LawURL", "Url", "法規網址"]), updatedAt: new Date() } }).returning();
        await db.delete(legalArticles).where(eq(legalArticles.documentId, doc.id));
        articleCount += await insertArticles(db, doc.id, law.LawArticles || law.Articles || law.條文);
      }
      const next = Math.min(total, cursor + entries.length);
      const done = Boolean(body.final) || next >= total;
      const [counts] = await db.select({ docs: sql<number>`count(distinct ${legalDocuments.id})`, articles: sql<number>`count(${legalArticles.id})` }).from(legalDocuments).leftJoin(legalArticles, eq(legalDocuments.id, legalArticles.documentId)).where(eq(legalDocuments.sourceKey, sourceKey));
      const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey)).groupBy(legalDocuments.category);
      const categoryCounts = Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)]));
      await db.update(legalDataSources).set({ status: done ? "ready" : "importing", importCursor: done ? total : next, totalAvailable: total, documentCount: Number(counts.docs || 0), articleCount: Number(counts.articles || 0), lastDownloadedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
      return Response.json({ sourceKey, status: done ? "ready" : "importing", processed: entries.length, next, total, articleCount, categoryCounts });
    }
    await db.update(legalDataSources).set({ status: "downloading", lastError: null, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
    if (sourceKey.startsWith("moj-")) {
      const { env } = await import("cloudflare:workers");
      let key = body.restart ? null : source.archiveStorageKey;
      if (!key) {
        const response = await fetch(source.sourceUrl, { headers: { "user-agent": "司律備考法規同步/1.0" } });
        if (!response.ok) throw new Error(`官方資料下載失敗（${response.status}）`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        key = `legal-archives/${sourceKey}-${Date.now()}.zip`;
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: response.headers.get("content-type") || "application/octet-stream" } });
      }
      if (!key) throw new Error("法規資料暫存位置不存在");
      const manifest = await getPreparedManifest(env.BUCKET, key, sourceKey);
      const start = body.restart ? 0 : source.importCursor;
      const batch = await readPreparedBatch(env.BUCKET, manifest, start);
      let articleCount = 0;
      for (const entry of batch) { const law = compactLegalRecord(entry.record); const title = legalTitle(law); if (!title) continue; const externalId = `${sourceKey}:${entry.category}:${title}`; const classification = legalClassification(law); const [doc] = await db.insert(legalDocuments).values({ sourceKey, externalId, title, category: entry.category, classification, modifiedDate: pickLegalValue(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), effectiveDate: pickLegalValue(law, ["LawEffectiveDate", "EffectiveDate", "生效日期"]), history: pickLegalValue(law, ["LawHistories", "Histories", "沿革內容"]), sourceUrl: pickLegalValue(law, ["LawURL", "Url", "法規網址"]) }).onConflictDoUpdate({ target: legalDocuments.externalId, set: { category: entry.category, classification, modifiedDate: pickLegalValue(law, ["LawModifiedDate", "ModifiedDate", "最新異動日期"]), effectiveDate: pickLegalValue(law, ["LawEffectiveDate", "EffectiveDate", "生效日期"]), history: pickLegalValue(law, ["LawHistories", "Histories", "沿革內容"]), updatedAt: new Date() } }).returning(); await db.delete(legalArticles).where(eq(legalArticles.documentId, doc.id)); articleCount += await insertArticles(db, doc.id, law.LawArticles || law.Articles || law.條文); }
      const next = start + batch.length; const done = next >= manifest.total; const [counts] = await db.select({ docs: sql<number>`count(distinct ${legalDocuments.id})`, articles: sql<number>`count(${legalArticles.id})` }).from(legalDocuments).leftJoin(legalArticles, eq(legalDocuments.id, legalArticles.documentId)).where(eq(legalDocuments.sourceKey, sourceKey)); const grouped = await db.select({ category: legalDocuments.category, count: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey)).groupBy(legalDocuments.category); const categoryCounts = Object.fromEntries(grouped.map((item) => [item.category || "其他", Number(item.count || 0)])); await db.update(legalDataSources).set({ status: done ? "ready" : "importing", archiveStorageKey: key, importCursor: done ? 0 : next, totalAvailable: manifest.total, documentCount: Number(counts.docs || 0), articleCount: Number(counts.articles || 0), lastDownloadedAt: new Date(), updatedAt: new Date() }).where(eq(legalDataSources.id, source.id)); return Response.json({ sourceKey, status: done ? "ready" : "importing", processed: batch.length, next, total: manifest.total, articleCount, categoryCounts });
    }
    const response = await fetch(source.sourceUrl, { headers: { "user-agent": "司律備考憲法資料同步/1.0" } });
    if (!response.ok) throw new Error(`憲法資料列表讀取失敗（${response.status}）`);
    const html = await response.text();
    const listings = extractConstitutionalListings(html, source.sourceUrl, sourceKey);
    if (!listings.length) throw new Error("官方列表沒有找到可同步的憲法資料，請確認官方網址或稍後重試");
    if (body.restart) await db.delete(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey));
    const cursor = body.restart ? 0 : Math.max(0, source.importCursor);
    const batchSize = 5;
    const batch = listings.slice(cursor, cursor + batchSize);
    let imported = 0;
    for (const listing of batch) {
      const detailResponse = await fetch(listing.sourceUrl, { headers: { "user-agent": "司律備考憲法資料同步/1.0" } });
      if (!detailResponse.ok) continue;
      const detailHtml = await detailResponse.text();
      const content = extractConstitutionalContent(detailHtml);
      const classification = sourceKey === "constitutional-interpretations" ? "解釋" : "判決";
      const [doc] = await db.insert(legalDocuments).values({ sourceKey, externalId: listing.externalId, title: listing.title, category: source.category, classification, modifiedDate: extractConstitutionalField(detailHtml, sourceKey === "constitutional-interpretations" ? "解釋公布院令" : "判決日期"), sourceUrl: listing.sourceUrl }).onConflictDoUpdate({ target: legalDocuments.externalId, set: { title: listing.title, category: source.category, classification, modifiedDate: extractConstitutionalField(detailHtml, sourceKey === "constitutional-interpretations" ? "解釋公布院令" : "判決日期"), sourceUrl: listing.sourceUrl, updatedAt: new Date() } }).returning();
      await db.delete(legalArticles).where(eq(legalArticles.documentId, doc.id));
      if (content) await db.insert(legalArticles).values({ documentId: doc.id, articleNo: "全文", hierarchy: classification, content, updatedAt: new Date() });
      imported++;
    }
    const next = Math.min(listings.length, cursor + batch.length);
    const done = next >= listings.length;
    const [count] = await db.select({ value: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.sourceKey, sourceKey));
    const [articleCount] = await db.select({ value: sql<number>`count(*)` }).from(legalArticles).innerJoin(legalDocuments, eq(legalArticles.documentId, legalDocuments.id)).where(eq(legalDocuments.sourceKey, sourceKey));
    await db.update(legalDataSources).set({ status: done ? "ready" : "importing", importCursor: done ? 0 : next, totalAvailable: listings.length, documentCount: Number(count.value || 0), articleCount: Number(articleCount.value || 0), lastDownloadedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id));
    return Response.json({ sourceKey, status: done ? "ready" : "importing", processed: imported, next, total: listings.length });
  } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : "資料同步失敗"; await db.update(legalDataSources).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(legalDataSources.id, source.id)); return Response.json({ error: message }, { status: 502 }); }
}
