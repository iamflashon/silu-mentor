import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, judicialCases } from "../../../db/schema";

const AUTH_URL = "https://data.judicial.gov.tw/jdg/api/Auth";
const LIST_URL = "https://data.judicial.gov.tw/jdg/api/JList";
const DOC_URL = "https://data.judicial.gov.tw/jdg/api/JDoc";
const QUEUE_KEY = "judicial_sync_queue";
const CURSOR_KEY = "judicial_sync_cursor";
const DEFAULT_BATCH_SIZE = 30;

type JsonObject = Record<string, unknown>;

function compact(text: string, limit = 240) {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

async function readApiResponse(response: Response, stage: string): Promise<unknown> {
  const raw = await response.text();
  const text = raw.trim();
  if (!text) {
    throw new Error(`司法院 ${stage} 回應為空白（HTTP ${response.status}）`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const detail = compact(text) || "未提供錯誤內容";
    throw new Error(`司法院 ${stage} 回應不是 JSON（HTTP ${response.status}）：${detail}`);
  }
}

function payloadError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const object = payload as JsonObject;
  for (const key of ["error", "Error", "message", "Message"]) {
    if (typeof object[key] === "string" && object[key].trim()) return object[key].trim();
  }
  return "";
}

function ensureApiSuccess(response: Response, payload: unknown, stage: string) {
  const error = payloadError(payload);
  if (!response.ok || error) {
    throw new Error(`司法院 ${stage} 失敗（HTTP ${response.status}）${error ? `：${compact(error)}` : ""}`);
  }
}

async function runtimeCredentials() {
  const { env } = await import("cloudflare:workers");
  return {
    user: env.JUDICIAL_API_USER ?? process.env.JUDICIAL_API_USER,
    password: env.JUDICIAL_API_PASSWORD ?? process.env.JUDICIAL_API_PASSWORD,
  };
}

async function auth() {
  const { user, password } = await runtimeCredentials();
  if (!user || !password) throw new Error("尚未設定 JUDICIAL_API_USER 或 JUDICIAL_API_PASSWORD");
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user, password }),
  });
  const payload = await readApiResponse(response, "Auth");
  ensureApiSuccess(response, payload, "帳密驗證");
  const object = payload && typeof payload === "object" ? payload as JsonObject : {};
  const token = typeof object.Token === "string" ? object.Token : typeof object.token === "string" ? object.token : "";
  if (!token) throw new Error(`司法院帳密驗證成功，但回應沒有 Token${payloadError(payload) ? `：${compact(payloadError(payload))}` : ""}`);
  return token;
}

async function setSetting(db: Awaited<ReturnType<typeof getDb>>, key: string, value: string) {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedAt: new Date() },
  });
}

async function getSetting(db: Awaited<ReturnType<typeof getDb>>, key: string) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? "";
}

function extractJids(payload: unknown) {
  const jids = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as JsonObject)) {
      if (key.toLowerCase() === "list" && Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string" && item.trim()) jids.add(item.trim());
        }
      } else {
        walk(child);
      }
    }
  };
  walk(payload);
  return [...jids];
}

async function loadQueue(db: Awaited<ReturnType<typeof getDb>>, token: string) {
  const rawQueue = await getSetting(db, QUEUE_KEY);
  const rawCursor = await getSetting(db, CURSOR_KEY);
  let queue: string[] = [];
  let cursor = Number.isInteger(Number(rawCursor)) ? Math.max(0, Number(rawCursor)) : 0;
  try {
    const parsed = JSON.parse(rawQueue) as unknown;
    if (Array.isArray(parsed)) queue = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    queue = [];
  }

  if (!queue.length || cursor >= queue.length) {
    const response = await fetch(LIST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await readApiResponse(response, "JList");
    ensureApiSuccess(response, payload, "取得裁判異動清單");
    queue = extractJids(payload);
    cursor = 0;
    await setSetting(db, QUEUE_KEY, JSON.stringify(queue));
    await setSetting(db, CURSOR_KEY, "0");
  }
  return { queue, cursor };
}

function isRemovedError(error: string) {
  return /移除|查無資料|查無裁判|不存在/.test(error);
}

async function downloadDocument(db: Awaited<ReturnType<typeof getDb>>, token: string, jid: string) {
  const response = await fetch(DOC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, j: jid }),
  });
  const payload = await readApiResponse(response, `JDoc（${jid}）`);
  const error = payloadError(payload);
  if (!response.ok || error) {
    if (isRemovedError(error)) {
      await db.delete(judicialCases).where(eq(judicialCases.jid, jid));
      return "removed" as const;
    }
    throw new Error(`下載裁判 ${jid} 失敗（HTTP ${response.status}）${error ? `：${compact(error)}` : ""}`);
  }

  const object = payload && typeof payload === "object" ? payload as JsonObject : {};
  const data = object.data && typeof object.data === "object" ? object.data as JsonObject : object;
  const parts = jid.split(",");
  await db.insert(judicialCases).values({
    jid,
    court: String(data.JCOURT || parts[0] || ""),
    year: String(data.JYEAR || parts[1] || ""),
    caseType: String(data.JCASE || parts[2] || ""),
    caseNo: String(data.JNO || parts[3] || ""),
    judgmentDate: String(data.JDATE || parts[4] || ""),
    title: String(data.JTITLE || data.JFULLTITLE || ""),
    fullText: String(data.JFULL || data.JTEXT || ""),
    rawJson: JSON.stringify(payload),
  }).onConflictDoUpdate({
    target: judicialCases.jid,
    set: {
      court: String(data.JCOURT || parts[0] || ""),
      year: String(data.JYEAR || parts[1] || ""),
      caseType: String(data.JCASE || parts[2] || ""),
      caseNo: String(data.JNO || parts[3] || ""),
      judgmentDate: String(data.JDATE || parts[4] || ""),
      title: String(data.JTITLE || data.JFULLTITLE || ""),
      fullText: String(data.JFULL || data.JTEXT || ""),
      rawJson: JSON.stringify(payload),
      status: "active",
      updatedAt: new Date(),
    },
  });
  return "imported" as const;
}

export async function GET() {
  const db = await getDb();
  const [count] = await db.select({ value: sql<number>`count(*)` }).from(judicialCases);
  const settings = await db.select().from(appSettings).where(sql`${appSettings.key} like 'judicial_%'`).orderBy(desc(appSettings.updatedAt));
  const { user, password } = await runtimeCredentials();
  return Response.json({
    configured: Boolean(user && password),
    caseCount: Number(count.value || 0),
    settings: Object.fromEntries(settings.map((item) => [item.key, item.value])),
    schedule: { enabled: true, time: "00:30", timezone: "Asia/Taipei", cron: "30 16 * * *" },
  });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; limit?: number };
  const taipeiHour = new Date(Date.now() + 8 * 3600_000).getUTCHours();
  if (taipeiHour >= 6 && body.action !== "test") {
    return Response.json({ error: "司法院 API 僅於每日 00:00 至 06:00 開放，請於服務時間執行" }, { status: 409 });
  }

  const db = await getDb();
  try {
    const token = await auth();
    await setSetting(db, "judicial_auth_status", "驗證成功");
    await setSetting(db, "judicial_last_auth_at", new Date().toISOString());
    if (body.action === "test") {
      return Response.json({ ok: true, message: "司法院 API 帳密驗證成功；Token 將由系統自動更新" });
    }

    const { queue, cursor: initialCursor } = await loadQueue(db, token);
    const limit = Math.max(1, Math.min(100, Number(body.limit) || DEFAULT_BATCH_SIZE));
    await setSetting(db, "judicial_last_error", "");
    let cursor = initialCursor;
    let imported = 0;
    let removed = 0;
    let failedJid = "";
    let failureReason = "";

    for (const jid of queue.slice(cursor, cursor + limit)) {
      try {
        const result = await downloadDocument(db, token, jid);
        if (result === "imported") imported++;
        if (result === "removed") removed++;
        cursor++;
        await setSetting(db, CURSOR_KEY, String(cursor));
      } catch (error) {
        failedJid = jid;
        failureReason = error instanceof Error ? compact(error.message) : "司法院未提供可辨識的錯誤內容";
        break;
      }
    }

    const pending = Math.max(0, queue.length - cursor);
    const completed = cursor >= queue.length;
    const summary = `異動 ${queue.length} 筆；本批下載 ${imported} 筆；移除 ${removed} 筆；目前完成 ${cursor}/${queue.length} 筆`;
    await setSetting(db, "judicial_last_sync_at", new Date().toISOString());
    await setSetting(db, "judicial_last_sync_summary", summary);
    await setSetting(db, "judicial_pending_count", String(pending));

    if (completed) {
      await setSetting(db, QUEUE_KEY, "[]");
      await setSetting(db, CURSOR_KEY, "0");
      await setSetting(db, "judicial_last_error", "");
    }

    if (failedJid) {
      const detail = `本批已完成 ${cursor - initialCursor} 筆；裁判 ${failedJid} 暫時下載失敗：${failureReason}。下次會從這筆繼續。`;
      await setSetting(db, "judicial_last_error", detail);
      return Response.json({ ok: false, total: queue.length, imported, removed, pending, error: detail }, { status: 502 });
    }

    return Response.json({ ok: true, total: queue.length, imported, removed, pending, message: `${summary}${pending ? "；請再次按立即下載一批繼續" : "；本次異動清單已完成"}` });
  } catch (error) {
    const message = error instanceof Error ? compact(error.message, 300) : "司法院同步失敗";
    await setSetting(db, "judicial_last_error", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
