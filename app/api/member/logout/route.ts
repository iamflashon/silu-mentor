import { safeReturnTo } from "../../../../lib/admin-entry-auth";

function signOutLocation(request: Request, returnTo: string) {
  return request.headers.get("x-silu-identity-provider") === "cloudflare-google"
    ? "/cdn-cgi/access/logout"
    : `/signout-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
}

export async function POST(request: Request) {
  return Response.json({ ok: true, signOut: signOutLocation(request, "/") }, { headers: { "cache-control": "no-store" } });
}

export function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"), "/");
  return new Response(null, { status: 302, headers: { location: signOutLocation(request, returnTo), "cache-control": "no-store" } });
}
