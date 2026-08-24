const accessLogout = "/cdn-cgi/access/logout";

export async function POST(request: Request) {
  return new Response(null, {
    status: 303,
    headers: { location: accessLogout, "cache-control": "no-store" },
  });
}

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { location: accessLogout, "cache-control": "no-store" },
  });
}
