import { appSettings } from "../../../../db/schema";
import { getDb } from "../../../../db";

const STATUS_KEY = "local_node_status";

function cleanText(value: unknown, fallback = "", max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function sameSecret(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [leftBuffer, rightBuffer] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(leftBuffer);
  const right = new Uint8Array(rightBuffer);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const expected = cleanText((env as typeof env & { LOCAL_NODE_TOKEN?: string }).LOCAL_NODE_TOKEN, "", 500);
  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : request.headers.get("x-local-node-token")?.trim() ?? "";
  if (!expected) return Response.json({ error: "本機節點金鑰尚未設定" }, { status: 503 });
  if (!received || !(await sameSecret(received, expected))) {
    return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "心跳資料格式錯誤" }, { status: 400 }); }
  const status = ["online", "busy", "error"].includes(String(body.status)) ? String(body.status) : "online";
  const models = Array.isArray(body.models)
    ? body.models.map((item) => cleanText(item, "", 100)).filter(Boolean).slice(0, 20)
    : [];
  const inboxFiles = Array.isArray(body.inboxFiles) ? body.inboxFiles.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = cleanText(row.name, "", 180);
    return name ? { name, sizeBytes: Math.floor(cleanNumber(row.sizeBytes) ?? 0), modifiedAt: Math.floor(cleanNumber(row.modifiedAt) ?? 0) } : null;
  }).filter((item): item is { name: string; sizeBytes: number; modifiedAt: number } => Boolean(item)).slice(0, 200) : [];
  const value = JSON.stringify({
    nodeId: cleanText(body.nodeId, "company-rtx4090", 80),
    name: cleanText(body.name, "公司 RTX 4090", 80),
    status,
    lastSeenAt: new Date().toISOString(),
    version: cleanText(body.version, "0.1.0", 30),
    gpu: cleanText(body.gpu, "RTX 4090", 100),
    gpuMemoryGb: cleanNumber(body.gpuMemoryGb),
    ramGb: cleanNumber(body.ramGb),
    models,
    queuedJobs: Math.floor(cleanNumber(body.queuedJobs) ?? 0),
    activeJob: cleanText(body.activeJob, "", 160),
    inboxFiles,
    message: cleanText(body.message, "節點運作正常", 240),
  });
  const db = await getDb("primary");
  await db.insert(appSettings).values({ key: STATUS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return Response.json({ ok: true, receivedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
