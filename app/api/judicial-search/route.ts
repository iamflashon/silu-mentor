import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { judicialCases } from "../../../db/schema";

function escapeLike(value: string) { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(extractText).filter(Boolean).join("\n");
  return "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const court = (url.searchParams.get("court") ?? "").trim().slice(0, 80);
  const year = (url.searchParams.get("year") ?? "").trim().replace(/\D/g, "").slice(0, 3);
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") ?? 12) || 12));
  try {
    const db = await getDb();
    const conditions = [eq(judicialCases.status, "active")];
    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      conditions.push(or(like(judicialCases.jid, pattern), like(judicialCases.title, pattern), like(judicialCases.fullText, pattern), like(judicialCases.caseType, pattern), like(judicialCases.caseNo, pattern))!);
    }
    if (court) conditions.push(like(judicialCases.court, `%${escapeLike(court)}%`));
    if (year) conditions.push(eq(judicialCases.year, year));
    const rows = await db.select().from(judicialCases).where(and(...conditions)).orderBy(desc(judicialCases.judgmentDate), desc(judicialCases.id)).limit(limit);
    return Response.json({ query, total: rows.length, results: rows.map((row) => {
      let fullText = row.fullText;
      if (!fullText && row.rawJson) {
        try {
          const payload = JSON.parse(row.rawJson) as { data?: { JFULLX?: unknown; JFULL?: unknown; JTEXT?: unknown } };
          fullText = extractText(payload.data?.JFULLX || payload.data?.JFULL || payload.data?.JTEXT);
        } catch { fullText = ""; }
      }
      return { id: row.id, jid: row.jid, court: row.court, year: row.year, caseType: row.caseType, caseNo: row.caseNo, judgmentDate: row.judgmentDate, title: row.title || `${row.year}年度${row.caseType}字第${row.caseNo}號`, fullText, excerpt: fullText.length > 260 ? `${fullText.slice(0, 260)}…` : fullText };
    }) });
  } catch {
    return Response.json({ error: "裁判資料尚未就緒，請稍後再搜尋" }, { status: 503 });
  }
}
