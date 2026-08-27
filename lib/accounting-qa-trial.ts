const COOKIE = "ibrain_accounting_qa_device";
export const BASE_LIMIT = 10;

function cookieValue(request: Request) {
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}
async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function ip(request: Request) { return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"; }
export async function trialIdentity(request: Request) {
  const ua = request.headers.get("user-agent") || "unknown";
  const ipHash = await digest(ip(request));
  const userAgentHash = await digest(ua);
  const existing = cookieValue(request);
  const deviceKey = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : await digest(`accounting-qa:${ipHash}:${userAgentHash}`);
  return { deviceKey, ipHash, userAgentHash, setCookie: existing ? "" : `${COOKIE}=${deviceKey}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` };
}
export async function ensureTrialDevice(request: Request) {
  const identity = await trialIdentity(request);
  const { env } = await import("cloudflare:workers");
  const now = Date.now();
  await env.DB.prepare("INSERT INTO accounting_qa_trial_devices (device_key, ip_hash, user_agent_hash, used_count, bonus_count, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, 0, 0, 'active', ?, ?) ON CONFLICT(device_key) DO UPDATE SET ip_hash=excluded.ip_hash, user_agent_hash=excluded.user_agent_hash, last_seen_at=excluded.last_seen_at")
    .bind(identity.deviceKey, identity.ipHash, identity.userAgentHash, now, now).run();
  return identity;
}
export async function trialStatus(request: Request) {
  const identity = await ensureTrialDevice(request);
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare("SELECT used_count AS usedCount, bonus_count AS bonusCount, status FROM accounting_qa_trial_devices WHERE device_key=?").bind(identity.deviceKey).first<{usedCount:number;bonusCount:number;status:string}>();
  const ipRow = await env.DB.prepare("SELECT COALESCE(SUM(used_count),0) AS usedCount, COALESCE(SUM(bonus_count),0) AS bonusCount, SUM(CASE WHEN status='blocked_ip' THEN 1 ELSE 0 END) AS blockedCount FROM accounting_qa_trial_devices WHERE ip_hash=?").bind(identity.ipHash).first<{usedCount:number;bonusCount:number;blockedCount:number}>();
  const pending = await env.DB.prepare("SELECT id FROM accounting_qa_trial_requests WHERE device_key=? AND status='pending' ORDER BY requested_at DESC LIMIT 1").bind(identity.deviceKey).first();
  const limit = BASE_LIMIT + Number(row?.bonusCount || 0), used = Number(row?.usedCount || 0);
  const ipLimit = BASE_LIMIT + Number(ipRow?.bonusCount || 0), ipUsed = Number(ipRow?.usedCount || 0);
  return { ...identity, used, limit, ipUsed, ipLimit, remaining: Math.max(0, Math.min(limit - used, ipLimit - ipUsed)), blocked: row?.status !== "active" || Number(ipRow?.blockedCount || 0) > 0 || used >= limit || ipUsed >= ipLimit, pending: Boolean(pending) };
}
export async function reserveTrialQuestion(request: Request) {
  const identity = await ensureTrialDevice(request);
  const { env } = await import("cloudflare:workers");
  const result = await env.DB.prepare("UPDATE accounting_qa_trial_devices SET used_count=used_count+1, last_seen_at=? WHERE device_key=? AND status='active' AND used_count < ? + bonus_count AND (SELECT COALESCE(SUM(used_count),0) FROM accounting_qa_trial_devices WHERE ip_hash=?) < ? + (SELECT COALESCE(SUM(bonus_count),0) FROM accounting_qa_trial_devices WHERE ip_hash=?) RETURNING used_count AS usedCount, bonus_count AS bonusCount")
    .bind(Date.now(), identity.deviceKey, BASE_LIMIT, identity.ipHash, BASE_LIMIT, identity.ipHash).first<{usedCount:number;bonusCount:number}>();
  if (!result) return { ok:false as const, ...(await trialStatus(request)) };
  const limit=BASE_LIMIT+Number(result.bonusCount||0), used=Number(result.usedCount||0);
  return { ok:true as const, ...identity, used, limit, remaining:Math.max(0,limit-used) };
}
export async function refundTrialQuestion(deviceKey: string) {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare("UPDATE accounting_qa_trial_devices SET used_count=MAX(0,used_count-1) WHERE device_key=?").bind(deviceKey).run();
}
