import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const { env } = await import("cloudflare:workers");
  const rows = await env.DB.prepare("SELECT r.id,r.member_id AS memberId,m.email,m.display_name AS displayName,r.reason,r.requested_quota AS requestedQuota,r.requested_days AS requestedDays,r.status,r.requested_at AS requestedAt,r.resolved_at AS resolvedAt,r.resolved_by AS resolvedBy,a.used_count AS usedCount,a.temporary_quota AS temporaryQuota,a.temporary_expires_at AS temporaryExpiresAt FROM legal_search_access_requests r JOIN members m ON m.id=r.member_id LEFT JOIN legal_search_access a ON a.member_id=r.member_id ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.requested_at DESC LIMIT 200").all();
  return Response.json({ requests: rows.results }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { id?: unknown; action?: unknown; quota?: unknown; days?: unknown };
  const id = Number(body.id), action = String(body.action || "");
  if (!id || !["approve", "reject"].includes(action)) return Response.json({ error: "操作資料不完整。" }, { status: 400 });
  const quota = Math.max(1, Math.min(100, Number(body.quota) || 10));
  const days = Math.max(1, Math.min(3, Number(body.days) || 1));
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare("SELECT member_id AS memberId,status FROM legal_search_access_requests WHERE id=?").bind(id).first<{ memberId: number; status: string }>();
  if (!row) return Response.json({ error: "找不到申請。" }, { status: 404 });
  if (row.status !== "pending") return Response.json({ error: "此申請已處理。" }, { status: 409 });
  const now = Date.now();
  if (action === "reject") {
    await env.DB.prepare("UPDATE legal_search_access_requests SET status='rejected',resolved_at=?,resolved_by=? WHERE id=? AND status='pending'").bind(now, auth.member.email, id).run();
  } else {
    const expiresAt = now + days * 86400000;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO legal_search_access (member_id,used_count,temporary_quota,temporary_expires_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET temporary_quota=?,temporary_expires_at=?,updated_at=?").bind(row.memberId, 0, quota, expiresAt, now, quota, expiresAt, now),
      env.DB.prepare("UPDATE legal_search_access_requests SET status='approved',requested_quota=?,requested_days=?,resolved_at=?,resolved_by=? WHERE id=? AND status='pending'").bind(quota, days, now, auth.member.email, id),
    ]);
  }
  return Response.json({ ok: true });
}
