import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { judicialCases } from "../db/schema";

export type JudicialSearchInput = {
  query?: string;
  court?: string;
  year?: string;
  limit?: number;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function extractJudicialText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractJudicialText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(extractJudicialText).filter(Boolean).join("\n");
  }
  return "";
}

function resolveFullText(row: { fullText: string; rawJson: string }) {
  if (row.fullText) return row.fullText;
  if (!row.rawJson) return "";
  try {
    const payload = JSON.parse(row.rawJson) as { data?: { JFULLX?: unknown; JFULL?: unknown; JTEXT?: unknown } };
    return extractJudicialText(payload.data?.JFULLX || payload.data?.JFULL || payload.data?.JTEXT);
  } catch {
    return "";
  }
}

function normalizeInput(input: JudicialSearchInput) {
  return {
    query: (input.query ?? "").trim().slice(0, 120),
    court: (input.court ?? "").trim().slice(0, 80),
    year: (input.year ?? "").replace(/\D/g, "").slice(0, 3),
    limit: Math.max(1, Math.min(30, Number(input.limit) || 12)),
  };
}

export async function searchJudicialCases(input: JudicialSearchInput) {
  const { query, court, year, limit } = normalizeInput(input);
  const db = await getDb();
  const [available] = await db.select({ value: sql<number>`count(*)` }).from(judicialCases).where(eq(judicialCases.status, "active"));
  const conditions = [eq(judicialCases.status, "active")];
  if (query) {
    const queryTerms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean).slice(0, 4);
    const searchableTerm = (term: string) => {
      const pattern = `%${escapeLike(term)}%`;
      return or(
        like(judicialCases.jid, pattern),
        like(judicialCases.title, pattern),
        like(judicialCases.fullText, pattern),
        like(judicialCases.court, pattern),
        like(judicialCases.caseType, pattern),
        like(judicialCases.caseNo, pattern),
      )!;
    };
    const compactQuery = query.replace(/[\s，,。．・：:（）()【】\[\]「」]/g, "");
    const compactPattern = `%${escapeLike(compactQuery)}%`;
    const composedCaseNo = sql<string>`${judicialCases.court} || ${judicialCases.year} || '年度' || ${judicialCases.caseType} || '字第' || ${judicialCases.caseNo} || '號'`;
    conditions.push(queryTerms.length > 1
      ? and(...queryTerms.map(searchableTerm))!
      : or(searchableTerm(queryTerms[0] ?? query), sql`${composedCaseNo} like ${compactPattern}`)!);
  }
  if (court) conditions.push(like(judicialCases.court, `%${escapeLike(court)}%`));
  if (year) conditions.push(eq(judicialCases.year, year));
  const rows = await db.select().from(judicialCases).where(and(...conditions)).orderBy(desc(judicialCases.judgmentDate), desc(judicialCases.id)).limit(limit);
  return {
    query,
    total: rows.length,
    availableTotal: Number(available?.value ?? 0),
    results: rows.map((row) => {
      const fullText = resolveFullText(row);
      return {
        id: row.id,
        jid: row.jid,
        court: row.court,
        year: row.year,
        caseType: row.caseType,
        caseNo: row.caseNo,
        judgmentDate: row.judgmentDate,
        title: row.title || `${row.year}年度${row.caseType}字第${row.caseNo}號`,
        fullText,
        excerpt: fullText.length > 260 ? `${fullText.slice(0, 260)}…` : fullText,
      };
    }),
  };
}

export async function getJudicialCaseDetail(jid: string) {
  const normalizedJid = jid.trim().slice(0, 160);
  if (!normalizedJid) return null;
  const db = await getDb();
  const [row] = await db.select().from(judicialCases).where(and(eq(judicialCases.status, "active"), eq(judicialCases.jid, normalizedJid))).limit(1);
  if (!row) return null;
  const fullText = resolveFullText(row);
  return {
    id: row.id,
    jid: row.jid,
    court: row.court,
    year: row.year,
    caseType: row.caseType,
    caseNo: row.caseNo,
    judgmentDate: row.judgmentDate,
    title: row.title || `${row.year}年度${row.caseType}字第${row.caseNo}號`,
    fullText,
  };
}
