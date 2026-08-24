import { safeReturnTo } from "../../../../lib/admin-entry-auth";

export async function POST() {
  return Response.json({ ok: true, signOut: "/signout-with-chatgpt?return_to=%2F" }, { headers: { "cache-control": "no-store" } });
}

export function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"), "/");
  return new Response(null, { status: 302, headers: { location: `/signout-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, "cache-control": "no-store" } });
}
