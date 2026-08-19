import { clearMemberSessionCookie } from "../../../../lib/member-session-auth";
import { safeReturnTo } from "../../../../lib/admin-entry-auth";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "set-cookie": clearMemberSessionCookie() } });
}

export function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"), "/");
  return new Response(null, { status: 302, headers: { location: returnTo, "cache-control": "no-store", "set-cookie": clearMemberSessionCookie() } });
}
