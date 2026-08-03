import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, judicialCases } from "../../../db/schema";

const AUTH_URL = "https://data.judicial.gov.tw/jdg/api/Auth";
const LIST_URL = "https://data.judicial.gov.tw/jdg/api/JList";
const DOC_URL = "https://data.judicial.gov.tw/jdg/api/JDoc";

async function auth() {
  const user = process.env.JUDICIAL_API_USER; const password = process.env.JUDICIAL_API_PASSWORD;
  if (!user || !password) throw new Error("尚未設定 JUDICIAL_API_USER 或 JUDICIAL_API_PASSWORD");
  const response = await fetch(AUTH_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, password }) }); const payload = await response.json() as { Token?: string; error?: string };
  if (!response.ok || !payload.Token) throw new Error(payload.error || "司法院帳密驗證失敗"); return payload.Token;
}
async function setting(key: string, value: string) { const db = await getDb(); await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } }); }

export async function GET() {
  const db = await getDb(); const [count] = await db.select({ value: sql<number>`count(*)` }).from(judicialCases); const settings = await db.select().from(appSettings).where(sql`${appSettings.key} like 'judicial_%'`).orderBy(desc(appSettings.updatedAt));
  return Response.json({ configured: Boolean(process.env.JUDICIAL_API_USER && process.env.JUDICIAL_API_PASSWORD), caseCount: Number(count.value || 0), settings: Object.fromEntries(settings.map((item) => [item.key, item.value])) });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; limit?: number }; const hour = new Date(Date.now() + 8 * 3600_000).getUTCHours(); if (hour >= 6 && body.action !== "test") return Response.json({ error: "司法院 API 僅於每日 00:00 至 06:00 開放，請於服務時間執行" }, { status: 409 });
  try {
    const token = await auth(); await setting("judicial_auth_status", "驗證成功"); await setting("judicial_last_auth_at", new Date().toISOString()); if (body.action === "test") return Response.json({ ok: true, message: "司法院 API 帳密驗證成功；Token 將由系統自動更新" });
    const listResponse = await fetch(LIST_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); const listPayload = await listResponse.json() as unknown;
    if (!listResponse.ok || (listPayload && typeof listPayload === "object" && "error" in listPayload)) throw new Error((listPayload as { error?: string }).error || "無法取得裁判異動清單");
    const jids: string[] = []; const walk = (value: unknown) => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") { for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (key.toLowerCase() === "list" && Array.isArray(child)) { for (const item of child) if (typeof item === "string") jids.push(item); } else walk(child); } } }; walk(listPayload);
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 30)); let imported = 0; let removed = 0; const db = await getDb();
    for (const jid of jids.slice(0, limit)) { const response = await fetch(DOC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, j: jid }) }); const payload = await response.json() as Record<string, unknown>; if (payload.error) { if (String(payload.error).includes("移除") || String(payload.error).includes("查無資料")) { await db.delete(judicialCases).where(eq(judicialCases.jid, jid)); removed++; } continue; } const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>; const parts = jid.split(","); await db.insert(judicialCases).values({ jid, court: String(data.JCOURT || parts[0] || ""), year: String(data.JYEAR || parts[1] || ""), caseType: String(data.JCASE || parts[2] || ""), caseNo: String(data.JNO || parts[3] || ""), judgmentDate: String(data.JDATE || parts[4] || ""), title: String(data.JTITLE || data.JFULLTITLE || ""), fullText: String(data.JFULL || data.JTEXT || ""), rawJson: JSON.stringify(payload) }).onConflictDoUpdate({ target: judicialCases.jid, set: { title: String(data.JTITLE || data.JFULLTITLE || ""), fullText: String(data.JFULL || data.JTEXT || ""), rawJson: JSON.stringify(payload), status: "active", updatedAt: new Date() } }); imported++; }
    await setting("judicial_last_sync_at", new Date().toISOString()); await setting("judicial_last_sync_summary", `異動 ${jids.length} 筆；本批下載 ${imported} 筆；移除 ${removed} 筆`); await setting("judicial_pending_count", String(Math.max(0, jids.length - Math.min(jids.length, limit)))); return Response.json({ ok: true, total: jids.length, imported, removed, pending: Math.max(0, jids.length - Math.min(jids.length, limit)) });
  } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : "司法院同步失敗"; await setting("judicial_last_error", message); return Response.json({ error: message }, { status: 502 }); }
}
