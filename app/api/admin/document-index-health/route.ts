import { asc, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentSearchUnits, documents } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

type HealthStatus = "healthy" | "repair_fine" | "repair_full" | "reocr" | "missing_source" | "processing" | "unsupported";

function suggestedStatus(row: {
  status: string;
  fileName: string;
  contentType: string;
  fullTextIndexed: boolean;
  vectorIndexed: boolean;
  pageCount: number | null;
  extractedChars: number;
}, sourceExists: boolean, units: { total: number; pageUnits: number; distinctPages: number; nullPages: number; textChars: number; shortUnits: number }) : { status: HealthStatus; reason: string; repairable: boolean } {
  if (!sourceExists) return { status: "missing_source", reason: "雲端找不到原始檔，需先由 Sites／R2 補檔", repairable: false };
  if (!/\.(?:pdf|html?|jsonl?|md|txt|docx|zip)$/iu.test(row.fileName)) return { status: "unsupported", reason: "圖片或其他附件不建立教材全文／頁面索引，已從批次修復排除", repairable: false };
  if (row.status !== "completed" && row.status !== "failed") return { status: "processing", reason: "教材仍在處理中，本次健檢不會介入", repairable: false };
  if (!row.fullTextIndexed || !row.vectorIndexed || row.status === "failed") return { status: "repair_full", reason: "全文或向量索引未完成，可由原稿接續重建", repairable: true };
  if (!units.total) return { status: "repair_fine", reason: "尚未建立頁面級精準索引", repairable: true };
  if (units.nullPages > 0 || (row.pageCount && units.distinctPages < row.pageCount)) return { status: "repair_fine", reason: `頁面索引不完整（${units.distinctPages}/${row.pageCount || "?"} 頁）`, repairable: true };
  const isPdf = /\.pdf(?:\.|$)/iu.test(row.fileName) || /\.local-index\.jsonl$/iu.test(row.fileName);
  const lowText = units.pageUnits > 0 && units.textChars / Math.max(1, units.distinctPages) < 80;
  const mostlyShort = units.total >= 3 && units.shortUnits / units.total > 0.45;
  if (isPdf && (lowText || mostlyShort)) return { status: "reocr", reason: "頁面文字量偏低或空白片段過多，建議交由 RTX 4090 重新 OCR", repairable: false };
  return { status: "healthy", reason: "全文、向量與頁面級索引均可用", repairable: false };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb("primary");
  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 12));
  const [{ total: allTotal }] = await db.select({ total: sql<number>`count(*)` }).from(documents);
  const rows = await db.select({
    id: documents.id,
    fileName: documents.fileName,
    contentType: documents.contentType,
    bookTitle: documents.bookTitle,
    storageKey: documents.storageKey,
    examCategory: documents.examCategory,
    subject: documents.subject,
    documentType: documents.documentType,
    status: documents.status,
    processingStage: documents.processingStage,
    pageCount: documents.pageCount,
    extractedChars: documents.extractedChars,
    fullTextIndexed: documents.fullTextIndexed,
    vectorIndexed: documents.vectorIndexed,
  }).from(documents).orderBy(asc(documents.id)).limit(limit).offset(offset);
  const unitRows = rows.length ? await db.select({
    documentId: documentSearchUnits.documentId,
    total: sql<number>`count(*)`,
    pageUnits: sql<number>`coalesce(sum(case when ${documentSearchUnits.pageStart} is not null then 1 else 0 end), 0)`,
    distinctPages: sql<number>`count(distinct ${documentSearchUnits.pageStart})`,
    nullPages: sql<number>`coalesce(sum(case when ${documentSearchUnits.pageStart} is null then 1 else 0 end), 0)`,
    textChars: sql<number>`coalesce(sum(length(${documentSearchUnits.text})), 0)`,
    shortUnits: sql<number>`coalesce(sum(case when length(trim(${documentSearchUnits.text})) < 40 then 1 else 0 end), 0)`,
  }).from(documentSearchUnits).where(inArray(documentSearchUnits.documentId, rows.map((row) => row.id))).groupBy(documentSearchUnits.documentId) : [];
  const unitMap = new Map(unitRows.map((row) => [row.documentId, {
    total: Number(row.total), pageUnits: Number(row.pageUnits), distinctPages: Number(row.distinctPages), nullPages: Number(row.nullPages), textChars: Number(row.textChars), shortUnits: Number(row.shortUnits),
  }]));
  const { env } = await import("cloudflare:workers");
  const sourceMap = new Map<number, boolean>();
  for (let offset = 0; offset < rows.length; offset += 20) {
    const checks = await Promise.all(rows.slice(offset, offset + 20).map(async (row) => [row.id, Boolean(await env.BUCKET?.head(row.storageKey))] as const));
    checks.forEach(([id, exists]) => sourceMap.set(id, exists));
  }
  const items = rows.map((row) => {
    const units = unitMap.get(row.id) ?? { total: 0, pageUnits: 0, distinctPages: 0, nullPages: 0, textChars: 0, shortUnits: 0 };
    const health = suggestedStatus(row, Boolean(sourceMap.get(row.id)), units);
    return { ...row, sourceExists: Boolean(sourceMap.get(row.id)), fineSearchUnitCount: units.total, indexedPages: units.distinctPages, indexedTextChars: units.textChars, healthStatus: health.status, healthReason: health.reason, repairable: health.repairable };
  });
  return Response.json({ scannedAt: new Date().toISOString(), total: Number(allTotal), offset, nextOffset: offset + items.length, done: offset + items.length >= Number(allTotal), items }, { headers: { "cache-control": "no-store" } });
}
