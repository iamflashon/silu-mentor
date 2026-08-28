import { clearAdminEntryCookie } from "../../../../lib/admin-entry-auth";

function logout(request: Request) {
  const requestUrl = new URL(request.url);
  const homeUrl = new URL("/platform", requestUrl.origin);

  return new Response(null, {
    status: 303,
    headers: {
      location: homeUrl.toString(),
      "cache-control": "no-store",
      "set-cookie": clearAdminEntryCookie(),
    },
  });
}

export async function GET(request: Request) {
  return logout(request);
}

export async function POST(request: Request) {
  return logout(request);
}
