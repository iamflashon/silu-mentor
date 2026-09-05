import { getDb } from "../../../../db";
import { appSettings, judicialCases } from "../../../../db/schema";
import { eq } from "drizzle-orm";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function authorized(request: Request) {
  const { env } = await import("cloudflare:workers");
  const expected = String((env as typeof env & { LOCAL_NODE_TOKEN?: string }).LOCAL_NODE_TOKEN ?? "").trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expected || !received) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(expected)), crypto.subtle.digest("SHA-256", encoder.encode(received))]);
  const left = new Uint8Array(a); const right = new Uint8Array(b); let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  let body: { records?: unknown[]; progress?: Record<string, unknown> };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "裁判批次格式錯誤" }, { status: 400 }); }
  const records = Array.isArray(body.records) ? body.records.slice(0, 25) : [];
  if (!records.length) return Response.json({ error: "本批沒有裁判資料" }, { status: 400 });
  const db = await getDb("primary");
  let imported = 0; let duplicates = 0; let rejected = 0;
  for (const raw of records) {
    const wrapper = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const source = wrapper.document && typeof wrapper.document === "object" ? wrapper.document as Record<string, unknown> : wrapper;
    const jid = text(source.JID, 180);
    const fullText = text(source.JFULL, 2_000_000);
    if (!jid || !fullText) { rejected++; continue; }
    const parts = jid.split(",");
    const values = {
      jid,
      court: text(source.JCOURT, 80) || parts[0] || "",
      year: text(source.JYEAR, 8) || parts[1] || "",
      caseType: text(source.JCASE, 40) || parts[2] || "",
      caseNo: text(source.JNO, 30) || parts[3] || "",
      judgmentDate: text(source.JDATE, 20) || parts[4] || "",
      title: text(source.JTITLE, 300),
      fullText,
      rawJson: JSON.stringify(source),
      status: "active",
      updatedAt: new Date(),
    };
    const [existing] = await db.select({ id: judicialCases.id }).from(judicialCases).where(eq(judicialCases.jid, jid)).limit(1);
    await db.insert(judicialCases).values(values).onConflictDoUpdate({ target: judicialCases.jid, set: values });
    if (existing) duplicates++; else imported++;
  }
  const progress = body.progress && typeof body.progress === "object" ? body.progress : {};
  await db.insert(appSettings).values({ key: "judicial_local_import_status", value: JSON.stringify({ ...progress, importedThisBatch: imported, rejectedThisBatch: rejected, receivedAt: new Date().toISOString() }), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify({ ...progress, importedThisBatch: imported, rejectedThisBatch: rejected, receivedAt: new Date().toISOString() }), updatedAt: new Date() } });
  return Response.json({ ok: true, imported, duplicates, rejected });
}
