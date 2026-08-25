import { requireMember } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return Response.json({ authenticated: false, member: null }, { status: auth.error.status, headers: { "cache-control": "no-store" } });
  const { id, email, displayName, role, canAdmin, status, className } = auth.member;
  return Response.json({ authenticated: true, member: { id, email, displayName, role, canAdmin, status, className } }, { headers: { "cache-control": "no-store" } });
}
