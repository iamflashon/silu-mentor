import { and, desc, eq, gte, like, lte, not, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { judicialCases } from "../db/schema";

export type JudicialSearchInput = {
  query?: string;
  court?: string;
  year?: string;
  anyTerms?: string;
  allTerms?: string;
  excludeTerms?: string;
  person?: string;
  courtLevel?: string;
  division?: string;
  caseType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  includeAvailableTotal?: boolean;
  fastListMode?: boolean;
  searchMode?: "auto" | "keyword" | "phrase";
};

export type JudicialDetailOptions = { offset?: number; maxChars?: number };

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

function findJudicialFullText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJudicialFullText(item);
      if (found) return found;
    }
    return "";
  }
  const object = value as Record<string, unknown>;
  for (const key of ["JFULLX", "JFULL", "JTEXT"]) {
    if (object[key] !== undefined && object[key] !== null) {
      const text = extractJudicialText(object[key]).trim();
      if (text) return text;
    }
  }
  for (const child of Object.values(object)) {
    const found = findJudicialFullText(child);
    if (found) return found;
  }
  return "";
}

function resolveFullText(row: { fullText: string; rawJson: string }) {
  if (row.fullText && row.fullText !== "[object Object]") return row.fullText;
  if (!row.rawJson) return "";
  try {
    return findJudicialFullText(JSON.parse(row.rawJson));
  } catch {
    return "";
  }
}

const COURT_CODE_NAMES: Record<string, string> = {
  TPSV: "最高法院民事庭", TPSM: "最高法院刑事庭", TPAA: "最高行政法院",
  TPHV: "臺灣高等法院民事庭", TPHM: "臺灣高等法院刑事庭",
  TPDV: "臺灣臺北地方法院民事庭", TPDM: "臺灣臺北地方法院刑事庭",
  SLDV: "臺灣士林地方法院民事庭", SLDM: "臺灣士林地方法院刑事庭",
  PCDV: "臺灣新北地方法院民事庭", PCDM: "臺灣新北地方法院刑事庭",
  TYDV: "臺灣桃園地方法院民事庭", TYDM: "臺灣桃園地方法院刑事庭",
  CLEV: "臺灣桃園地方法院中壢簡易庭", TPEV: "臺北簡易庭",
  ILEV: "臺灣宜蘭地方法院宜蘭簡易庭", ILDV: "臺灣宜蘭地方法院民事庭",
  CYEV: "臺灣嘉義地方法院嘉義簡易庭",
  TCDV: "臺灣臺中地方法院民事庭", TCDM: "臺灣臺中地方法院刑事庭",
  TNDV: "臺灣臺南地方法院民事庭", TNDM: "臺灣臺南地方法院刑事庭",
  KSDV: "臺灣高雄地方法院民事庭", KSDM: "臺灣高雄地方法院刑事庭",
};

export function judicialCourtName(value: string, jid = "") {
  const code = (value || jid.split(",")[0] || "").trim();
  return COURT_CODE_NAMES[code] ?? value ?? code;
}

function normalizeInput(input: JudicialSearchInput) {
  const short = (value: string | undefined, limit = 120) => (value ?? "").trim().slice(0, limit);
  return {
    query: short(input.query),
    court: short(input.court, 80),
    year: (input.year ?? "").replace(/\D/g, "").slice(0, 3),
    anyTerms: short(input.anyTerms), allTerms: short(input.allTerms), excludeTerms: short(input.excludeTerms),
    person: short(input.person, 80), courtLevel: short(input.courtLevel, 24), division: short(input.division, 24),
    caseType: short(input.caseType, 24),
    dateFrom: (input.dateFrom ?? "").replace(/\D/g, "").slice(0, 8),
    dateTo: (input.dateTo ?? "").replace(/\D/g, "").slice(0, 8),
    limit: Math.max(1, Math.min(30, Number(input.limit) || 12)),
    offset: Math.max(0, Math.min(100_000, Math.floor(Number(input.offset) || 0))),
    searchMode: input.searchMode === "keyword" || input.searchMode === "phrase" ? input.searchMode : "auto" as const,
  };
}

function parseDocketQuery(query: string) {
  const compact = query.replace(/[\s，,。．・：:（）()【】\[\]「」]/g, "");
  const match = compact.match(/(?:民國)?(\d{2,3})年度([^第號]{1,12}?)(?:字)?第?(\d{1,9})號?/);
  if (!match) return null;
  return { year: match[1], caseType: match[2].replace(/字$/, ""), caseNo: match[3] };
}

export async function searchJudicialCases(input: JudicialSearchInput) {
  const { query, court, year, anyTerms, allTerms, excludeTerms, person, courtLevel, division, caseType, dateFrom, dateTo, limit, offset, searchMode } = normalizeInput(input);
  const db = await getDb();
  const fastListMode = input.fastListMode === true;
  const [available] = input.includeAvailableTotal === false || fastListMode
    ? [{ value: 0 }]
    : await db.select({ value: sql<number>`count(*)` }).from(judicialCases).where(eq(judicialCases.status, "active"));
  const conditions = [eq(judicialCases.status, "active")];
  const splitTerms = (value: string) => value.split(/[\s，、；;＋+]+/).map((term) => term.trim()).filter((term) => term.length >= 2).slice(0, 8);
  const searchableTerm = (term: string) => {
    const pattern = `%${escapeLike(term)}%`;
    return or(
      like(judicialCases.jid, pattern), like(judicialCases.title, pattern), like(judicialCases.fullText, pattern),
      // raw_json normally duplicates full_text and can be several times larger. Scanning
      // both columns made every MCP keyword search do redundant full-table work.
      like(judicialCases.court, pattern), like(judicialCases.caseType, pattern), like(judicialCases.caseNo, pattern),
    )!;
  };
  const docket = searchMode === "keyword" ? null : parseDocketQuery(query);
  if (query) {
    const queryTerms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean).slice(0, 4);
    const compactQuery = query.replace(/[\s，,。．・：:（）()【】\[\]「」]/g, "");
    const compactPattern = `%${escapeLike(compactQuery)}%`;
    const composedCaseNo = sql<string>`${judicialCases.court} || ${judicialCases.year} || '年度' || ${judicialCases.caseType} || '字第' || ${judicialCases.caseNo} || '號'`;
    if (docket) {
      conditions.push(and(eq(judicialCases.year, docket.year), eq(judicialCases.caseType, docket.caseType), eq(judicialCases.caseNo, docket.caseNo))!);
    } else if (searchMode === "phrase") {
      conditions.push(searchableTerm(query));
    } else {
      conditions.push(queryTerms.length > 1
        ? and(...queryTerms.map(searchableTerm))!
        : or(searchableTerm(queryTerms[0] ?? query), sql`${composedCaseNo} like ${compactPattern}`)!);
    }
  }
  const optionalTerms = splitTerms(anyTerms);
  if (optionalTerms.length) conditions.push(or(...optionalTerms.map(searchableTerm))!);
  const requiredTerms = splitTerms(allTerms);
  if (requiredTerms.length) conditions.push(and(...requiredTerms.map(searchableTerm))!);
  for (const term of splitTerms(excludeTerms)) conditions.push(not(searchableTerm(term)));
  if (person) {
    const pattern = `%${escapeLike(person)}%`;
    conditions.push(or(like(judicialCases.fullText, pattern), like(judicialCases.rawJson, pattern))!);
  }
  if (court) conditions.push(like(judicialCases.court, `%${escapeLike(court)}%`));
  if (year) conditions.push(eq(judicialCases.year, year));
  if (caseType) conditions.push(like(judicialCases.caseType, `%${escapeLike(caseType)}%`));
  if (dateFrom) conditions.push(gte(judicialCases.judgmentDate, dateFrom));
  if (dateTo) conditions.push(lte(judicialCases.judgmentDate, dateTo));
  if (division === "civil") conditions.push(like(judicialCases.court, "%V"));
  if (division === "criminal") conditions.push(like(judicialCases.court, "%M"));
  if (division === "administrative") conditions.push(like(judicialCases.court, "%A"));
  if (courtLevel === "supreme") conditions.push(or(like(judicialCases.court, "TPS%"), like(judicialCases.court, "TPAA%"))!);
  if (courtLevel === "high") conditions.push(or(like(judicialCases.court, "TPH%"), like(judicialCases.court, "TCH%"), like(judicialCases.court, "TNH%"), like(judicialCases.court, "KSH%"), like(judicialCases.court, "HLH%"))!);
  if (courtLevel === "district") conditions.push(or(like(judicialCases.court, "%DV"), like(judicialCases.court, "%DM"), like(judicialCases.court, "%EV"))!);
  const whereClause = and(...conditions);
  const rankingTerms = [...new Set([...splitTerms(query), ...optionalTerms, ...requiredTerms])].slice(0, 10);
  const scoreParts = [sql<number>`0`];
  if (query) {
    const phrasePattern = `%${escapeLike(query)}%`;
    scoreParts.push(sql<number>`case when ${judicialCases.title} like ${phrasePattern} then 60 else 0 end`);
    scoreParts.push(sql<number>`case when ${judicialCases.fullText} like ${phrasePattern} then 24 else 0 end`);
    scoreParts.push(sql<number>`case when ${judicialCases.jid} like ${phrasePattern} then 100 else 0 end`);
  }
  for (const term of rankingTerms) {
    const pattern = `%${escapeLike(term)}%`;
    scoreParts.push(sql<number>`case when ${judicialCases.title} like ${pattern} then 14 else 0 end`);
    scoreParts.push(sql<number>`case when ${judicialCases.fullText} like ${pattern} then 4 else 0 end`);
  }
  if (court || courtLevel) scoreParts.push(sql<number>`8`);
  if (year || dateFrom || dateTo) scoreParts.push(sql<number>`4`);
  const relevanceScore = sql<number>`(${sql.join(scoreParts, sql.raw(" + "))})`;
  // Homepage/MCP list searches need useful candidates, not an expensive exact count of
  // every matching judgment. In fast mode, scan newest matching rows through the primary
  // key, take a bounded candidate pool, and rank that pool in memory. This avoids a COUNT
  // plus a second full scan/sort over the complete full_text corpus.
  const candidateLimit = fastListMode ? Math.min(240, Math.max(limit * 8, offset + limit)) : limit;
  const baseSelection = {
    id: judicialCases.id,
    jid: judicialCases.jid,
    court: judicialCases.court,
    year: judicialCases.year,
    caseType: judicialCases.caseType,
    caseNo: judicialCases.caseNo,
    judgmentDate: judicialCases.judgmentDate,
    title: judicialCases.title,
    // Search lists only display the opening excerpt. Keep the candidate pool bounded
    // in Worker memory; complete text is fetched separately by get_case_detail.
    fullText: sql<string>`substr(${judicialCases.fullText}, 1, 1200)`,
  };
  const candidateRows = fastListMode
    ? await db.select(baseSelection).from(judicialCases).where(whereClause)
      .orderBy(desc(judicialCases.id)).limit(candidateLimit)
    : await db.select(baseSelection).from(judicialCases).where(whereClause)
      .orderBy(desc(relevanceScore), desc(judicialCases.judgmentDate), desc(judicialCases.id)).limit(limit).offset(offset);
  const rankingWords = [...new Set([query, ...rankingTerms])].filter(Boolean);
  const rowScore = (row: typeof candidateRows[number]) => {
    const titleText = row.title.toLowerCase();
    const bodyText = row.fullText.toLowerCase();
    return rankingWords.reduce((score, term) => {
      const word = term.toLowerCase();
      return score + (titleText.includes(word) ? 14 : 0) + (bodyText.includes(word) ? 4 : 0);
    }, query && titleText.includes(query.toLowerCase()) ? 60 : 0);
  };
  const rows = fastListMode
    ? candidateRows.sort((a, b) => rowScore(b) - rowScore(a) || b.judgmentDate.localeCompare(a.judgmentDate) || b.id - a.id).slice(offset, offset + limit)
    : candidateRows;
  const matched = fastListMode
    ? { value: offset + rows.length + (candidateRows.length === candidateLimit ? 1 : 0) }
    : (await db.select({ value: sql<number>`count(*)` }).from(judicialCases).where(whereClause))[0];
  return {
    query,
    searchMode: docket ? "docket_exact" : searchMode === "phrase" ? "phrase" : "keyword",
    exactDocket: docket,
    searchNotice: docket && !Number(matched?.value ?? 0)
      ? "查無這個完整案號；不得用近似案號或其他案件替代。請核對法院、年度、字別與案號，並確認該裁判是否已入庫。"
      : "搜尋結果只是候選資料；引用前仍須依 JID 讀取並核對全文。",
    total: Number(matched?.value ?? 0),
    returned: rows.length,
    limit,
    offset,
    availableTotal: Number(available?.value ?? 0),
    results: rows.map((row, index) => {
      const fullText = row.fullText && row.fullText !== "[object Object]" ? row.fullText : "";
      return {
        rank: offset + index + 1,
        relevanceBand: offset + index < 3 ? "高度相關" : offset + index < 10 ? "相關" : "延伸參考",
        id: row.id,
        jid: row.jid,
        court: judicialCourtName(row.court, row.jid),
        courtCode: row.court,
        year: row.year,
        caseType: row.caseType,
        caseNo: row.caseNo,
        judgmentDate: row.judgmentDate,
        title: row.title || `${row.year}年度${row.caseType}字第${row.caseNo}號`,
        fullText,
        excerpt: (fullText.length > 260 ? `${fullText.slice(0, 260)}…` : fullText).replace(/^\s*file\s+/i, ""),
      };
    }),
  };
}

export async function getJudicialCaseDetail(jid: string, options: JudicialDetailOptions = {}) {
  const normalizedJid = jid.trim().slice(0, 160);
  if (!normalizedJid) return null;
  const db = await getDb();
  const [row] = await db.select().from(judicialCases).where(and(eq(judicialCases.status, "active"), eq(judicialCases.jid, normalizedJid))).limit(1);
  if (!row) return null;
  const fullText = resolveFullText(row);
  const offset = Math.max(0, Math.min(fullText.length, Math.floor(Number(options.offset) || 0)));
  const maxChars = Math.max(2_000, Math.min(50_000, Math.floor(Number(options.maxChars) || 50_000)));
  const excerpt = fullText.slice(offset, offset + maxChars);
  const nextOffset = offset + excerpt.length < fullText.length ? offset + excerpt.length : null;
  return {
    id: row.id,
    jid: row.jid,
    court: judicialCourtName(row.court, row.jid),
    courtCode: row.court,
    year: row.year,
    caseType: row.caseType,
    caseNo: row.caseNo,
    judgmentDate: row.judgmentDate,
    title: row.title || `${row.year}年度${row.caseType}字第${row.caseNo}號`,
    fullText: excerpt,
    fullTextOffset: offset,
    fullTextReturnedChars: excerpt.length,
    fullTextTotalChars: fullText.length,
    fullTextTruncated: nextOffset !== null,
    nextOffset,
  };
}
