const accessLogout = "/cdn-cgi/access/logout";

function safeReturnPath(request: Request) {
  const requested = new URL(request.url).searchParams.get("return_to") || "/";
  return requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")
    ? requested
    : "/";
}

function accessLogoutPath(request: Request) {
  const returnTo = new URL(safeReturnPath(request), request.url).toString();
  return `${accessLogout}?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function POST(request: Request) {
  return new Response(null, {
    status: 303,
    headers: { location: accessLogoutPath(request), "cache-control": "no-store" },
  });
}

export function GET(request: Request) {
  return new Response(null, {
    status: 302,
    headers: { location: accessLogoutPath(request), "cache-control": "no-store" },
  });
}
