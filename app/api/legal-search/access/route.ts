import { legalSearchAccess } from "../../../../lib/legal-search-access";

export async function GET(request: Request) {
  const access = await legalSearchAccess(request);
  if ("error" in access) return access.error;
  const { env } = await import("cloudflare:workers");
  const pending = access.member.canAdmin ? null : await env.DB.prepare("SELECT id,requested_at AS requestedAt FROM legal_search_access_requests WHERE member_id=? AND status='pending' ORDER BY requested_at DESC LIMIT 1").bind(access.member.id).first();
  return Response.json({ metered: access.metered, used: access.used, limit: access.limit, remaining: access.remaining, temporaryExpiresAt: access.temporaryExpiresAt, pendingRequest: pending }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await legalSearchAccess(request);
  if ("error" in access) return access.error;
  if (!access.metered) return Response.json({ error: "管理者不需要申請額度。" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { reason?: unknown; requestedQuota?: unknown; requestedDays?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const requestedQuota = Math.max(1, Math.min(100, Number(body.requestedQuota) || 10));
  const requestedDays = Math.max(1, Math.min(3, Number(body.requestedDays) || 1));
  if (reason.length < 4) return Response.json({ error: "請簡短說明測試用途。" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const existing = await env.DB.prepare("SELECT id FROM legal_search_access_requests WHERE member_id=? AND status='pending' LIMIT 1").bind(access.member.id).first();
  if (existing) return Response.json({ error: "你已有一筆待審申請。" }, { status: 409 });
  await env.DB.prepare("INSERT INTO legal_search_access_requests (member_id,reason,requested_quota,requested_days,status,requested_at,resolved_by) VALUES (?,?,?,?,?,?,?)")
    .bind(access.member.id, reason, requestedQuota, requestedDays, "pending", Date.now(), "").run();
  return Response.json({ ok: true });
}
