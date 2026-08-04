import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, judicialCases } from "../../../db/schema";

const AUTH_URL = "https://data.judicial.gov.tw/jdg/api/Auth";
const LIST_URL = "https://data.judicial.gov.tw/jdg/api/JList";
const DOC_URL = "https://data.judicial.gov.tw/jdg/api/JDoc";
const QUEUE_KEY = "judicial_sync_queue";
const CURSOR_KEY = "judicial_sync_cursor";
const FAILURES_KEY = "judicial_sync_failures";
const CYCLE_DATE_KEY = "judicial_sync_cycle_date";
const LOCK_KEY = "judicial_sync_lock_until";
const DEFAULT_BATCH_SIZE = 30;
const MAX_RETRY_ATTEMPTS = 3;
const LOCK_TTL_MS = 15 * 60 * 1000;
const JUDICIAL_SCHEDULE = {
  enabled: true,
  time: "00:30",
  timezone: "Asia/Taipei",
  cron: ["30-59/5 16 * * *", "*/5 17-21 * * *"],
  intervalMinutes: 5,
  window: "00:30–05:55",
};

type JsonObject = Record<string, unknown>;
type SyncFailure = {
  jid: string;
  reason: string;
  attempts: number;
  lastFailedAt: string;
};

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

function taipeiDate() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

async function acquireSyncLock(db: Awaited<ReturnType<typeof getDb>>) {
  const now = Date.now();
  const lockUntil = now + LOCK_TTL_MS;
  await db.insert(appSettings).values({
    key: LOCK_KEY,
    value: "0",
    updatedAt: new Date(0),
  }).onConflictDoNothing();
  const acquired = await db.update(appSettings)
    .set({ value: String(lockUntil), updatedAt: new Date() })
    .where(and(
      eq(appSettings.key, LOCK_KEY),
      sql`CAST(${appSettings.value} AS INTEGER) <= ${now}`,
    ))
    .returning({ key: appSettings.key });
  return acquired.length > 0;
}

async function releaseSyncLock(db: Awaited<ReturnType<typeof getDb>>) {
  await db.update(appSettings)
    .set({ value: "0", updatedAt: new Date() })
    .where(eq(appSettings.key, LOCK_KEY));
}

async function getFailures(db: Awaited<ReturnType<typeof getDb>>) {
  const raw = await getSetting(db, FAILURES_KEY);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [] as SyncFailure[];
    return parsed.flatMap((item): SyncFailure[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as JsonObject;
      const jid = typeof value.jid === "string" ? value.jid.trim() : "";
      if (!jid) return [];
      return [{
        jid,
        reason: typeof value.reason === "string" ? compact(value.reason, 300) : "司法院未提供可辨識的錯誤內容",
        attempts: Math.max(1, Number(value.attempts) || 1),
        lastFailedAt: typeof value.lastFailedAt === "string" ? value.lastFailedAt : new Date().toISOString(),
      }];
    });
  } catch {
    return [] as SyncFailure[];
  }
}

async function saveFailures(db: Awaited<ReturnType<typeof getDb>>, failures: SyncFailure[]) {
  await setSetting(db, FAILURES_KEY, JSON.stringify(failures));
}

function retryableFailures(failures: SyncFailure[]) {
  return failures.filter((failure) => failure.attempts < MAX_RETRY_ATTEMPTS);
}

function failureSummary(failures: SyncFailure[]) {
  const retryable = retryableFailures(failures);
  const permanent = failures.filter((failure) => failure.attempts >= MAX_RETRY_ATTEMPTS);
  return { retryable, permanent };
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

async function loadQueue(db: Awaited<ReturnType<typeof getDb>>, token: string, failures: SyncFailure[]) {
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
    const permanentlyFailed = new Set(
      failures.filter((failure) => failure.attempts >= MAX_RETRY_ATTEMPTS).map((failure) => failure.jid),
    );
    queue = extractJids(payload).filter((jid) => !permanentlyFailed.has(jid));
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
    fullText: String(data.JFULLX || data.JFULL || data.JTEXT || ""),
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
      fullText: String(data.JFULLX || data.JFULL || data.JTEXT || ""),
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
  const failures = await getFailures(db);
  const { retryable, permanent } = failureSummary(failures);
  const { user, password } = await runtimeCredentials();
  return Response.json({
    configured: Boolean(user && password),
    caseCount: Number(count.value || 0),
    settings: Object.fromEntries(settings.map((item) => [item.key, item.value])),
    failedCount: retryable.length,
    permanentFailureCount: permanent.length,
    failedCases: failures,
    schedule: JUDICIAL_SCHEDULE,
  });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; limit?: number };
  const scheduled = request.headers.get("x-scheduled-sync") === "1";
  const taipeiHour = new Date(Date.now() + 8 * 3600_000).getUTCHours();
  if (taipeiHour >= 6 && body.action !== "test") {
    return Response.json({ error: "司法院 API 僅於每日 00:00 至 06:00 開放，請於服務時間執行" }, { status: 409 });
  }

  const db = await getDb();
  let lockAcquired = false;
  try {
    if (body.action !== "test") {
      // Once the current day's queue and retry queue are both complete, the
      // five-minute cron must stay idle instead of downloading the same JList
      // repeatedly. A new Taipei date starts a fresh queue automatically.
      if (scheduled && (await getSetting(db, CYCLE_DATE_KEY)) === taipeiDate()) {
        return Response.json({
          ok: true,
          skipped: true,
          message: "今日裁判清單已完成，系統將於下一個服務時段自動繼續。",
        });
      }
      lockAcquired = await acquireSyncLock(db);
      if (!lockAcquired) {
        return Response.json({
          ok: true,
          busy: true,
          message: "上一批同步仍在處理，系統會在下一個 5 分鐘週期自動續接。",
        }, { status: 202 });
      }
    }
    const token = await auth();
    await setSetting(db, "judicial_auth_status", "驗證成功");
    await setSetting(db, "judicial_last_auth_at", new Date().toISOString());
    if (body.action === "test") {
      return Response.json({ ok: true, message: "司法院 API 帳密驗證成功；Token 將由系統自動更新" });
    }

    let failures = await getFailures(db);
    const { queue, cursor: initialCursor } = await loadQueue(db, token, failures);
    const limit = Math.max(1, Math.min(100, Number(body.limit) || DEFAULT_BATCH_SIZE));
    await setSetting(db, "judicial_last_error", "");
    let cursor = initialCursor;
    let imported = 0;
    let removed = 0;
    let skipped = 0;
    const batchFailures: SyncFailure[] = [];

    for (const jid of queue.slice(cursor, cursor + limit)) {
      try {
        const result = await downloadDocument(db, token, jid);
        if (result === "imported") imported++;
        if (result === "removed") removed++;
        failures = failures.filter((failure) => failure.jid !== jid);
        await saveFailures(db, failures);
        cursor++;
        await setSetting(db, CURSOR_KEY, String(cursor));
      } catch (error) {
        const failureReason = error instanceof Error ? compact(error.message, 300) : "司法院未提供可辨識的錯誤內容";
        const previous = failures.find((failure) => failure.jid === jid);
        const failure: SyncFailure = {
          jid,
          reason: failureReason,
          attempts: (previous?.attempts ?? 0) + 1,
          lastFailedAt: new Date().toISOString(),
        };
        failures = [...failures.filter((item) => item.jid !== jid), failure];
        batchFailures.push(failure);
        skipped++;
        await saveFailures(db, failures);
        // A malformed or temporarily unavailable official record must not block
        // the rest of the queue. Keep the JID for a later retry and advance the
        // cursor immediately so the next batch can continue.
        cursor++;
        await setSetting(db, CURSOR_KEY, String(cursor));
      }
    }

    const { retryable, permanent } = failureSummary(failures);
    const pending = Math.max(0, queue.length - cursor) + retryable.length;
    const completed = cursor >= queue.length;
    const summary = `異動 ${queue.length} 筆；本批下載 ${imported} 筆；移除 ${removed} 筆；略過 ${skipped} 筆；目前完成 ${cursor}/${queue.length} 筆`;
    await setSetting(db, "judicial_last_sync_at", new Date().toISOString());
    await setSetting(db, "judicial_last_sync_summary", summary);
    await setSetting(db, "judicial_pending_count", String(pending));

    if (completed) {
      if (retryable.length) {
        // Run failed records as a small retry queue after the main queue is
        // exhausted. They remain visible and are never silently discarded.
        await setSetting(db, QUEUE_KEY, JSON.stringify(retryable.map((failure) => failure.jid)));
        await setSetting(db, CURSOR_KEY, "0");
      } else {
        await setSetting(db, QUEUE_KEY, "[]");
        await setSetting(db, CURSOR_KEY, "0");
        await setSetting(db, CYCLE_DATE_KEY, taipeiDate());
      }
    }

    if (batchFailures.length) {
      const first = batchFailures[0];
      const detail = `本批已完成 ${cursor - initialCursor} 筆；另有 ${batchFailures.length} 筆裁判暫時無法解析，已先跳過並保留待重試。${first ? `代表資料：${first.jid}（第 ${first.attempts}/${MAX_RETRY_ATTEMPTS} 次）：${first.reason}` : ""}${permanent.length ? `目前有 ${permanent.length} 筆已達重試上限，請保留錯誤紀錄後再處理。` : ""}`;
      await setSetting(db, "judicial_last_error", detail);
      return Response.json({ ok: true, partial: true, total: queue.length, imported, removed, skipped, pending, warning: detail, message: `${summary}；待重試 ${retryable.length} 筆` });
    }

    if (!retryable.length && !permanent.length) await setSetting(db, "judicial_last_error", "");
    return Response.json({ ok: true, total: queue.length, imported, removed, skipped, pending, message: `${summary}${pending ? `；待重試 ${retryable.length} 筆，請再次按立即下載一批` : "；本次異動清單已完成"}` });
  } catch (error) {
    const message = error instanceof Error ? compact(error.message, 300) : "司法院同步失敗";
    await setSetting(db, "judicial_last_error", message);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    if (lockAcquired) await releaseSyncLock(db);
  }
}
