import { requireMember } from "./member-auth";

export const LEGAL_SEARCH_BASE_QUOTA = 100;

type AccessRow = { usedCount: number; temporaryQuota: number; temporaryExpiresAt: number | null };

export async function legalSearchAccess(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth;
  if (auth.member.canAdmin) return { ...auth, metered: false as const, used: 0, limit: null, remaining: null, temporaryExpiresAt: null };
  const { env } = await import("cloudflare:workers");
  const now = Date.now();
  await env.DB.prepare("INSERT INTO legal_search_access (member_id,used_count,temporary_quota,temporary_expires_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id) DO NOTHING")
    .bind(auth.member.id, 0, 0, null, now).run();
  const row = await env.DB.prepare("SELECT used_count AS usedCount,temporary_quota AS temporaryQuota,temporary_expires_at AS temporaryExpiresAt FROM legal_search_access WHERE member_id=?")
    .bind(auth.member.id).first<AccessRow>();
  const temporaryActive = !!row?.temporaryExpiresAt && row.temporaryExpiresAt > now;
  const limit = LEGAL_SEARCH_BASE_QUOTA + (temporaryActive ? Math.max(0, row?.temporaryQuota || 0) : 0);
  const used = row?.usedCount || 0;
  return { ...auth, metered: true as const, used, limit, remaining: Math.max(0, limit - used), temporaryExpiresAt: temporaryActive ? row!.temporaryExpiresAt : null };
}

export async function consumeLegalSearch(request: Request) {
  const access = await legalSearchAccess(request);
  if ("error" in access || !access.metered) return access;
  if (access.remaining <= 0) return { ...access, exhausted: true as const };
  const { env } = await import("cloudflare:workers");
  const result = await env.DB.prepare("UPDATE legal_search_access SET used_count=used_count+1,updated_at=? WHERE member_id=? AND used_count<?")
    .bind(Date.now(), access.member.id, access.limit).run();
  if (!result.meta.changes) return { ...access, remaining: 0, exhausted: true as const };
  return { ...access, used: access.used + 1, remaining: access.remaining - 1, exhausted: false as const };
}
