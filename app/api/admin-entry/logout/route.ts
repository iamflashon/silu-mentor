import { clearAdminEntryCookie } from "../../../../lib/admin-entry-auth";

function logout(request: Request) {
  const requestUrl = new URL(request.url);
  const homeUrl = new URL("/", requestUrl.origin);
  const isCloudflareAccessHost = requestUrl.hostname.endsWith(".workers.dev");
  const destination = isCloudflareAccessHost
    ? new URL("/cdn-cgi/access/logout", requestUrl.origin)
    : homeUrl;

  if (isCloudflareAccessHost) {
    destination.searchParams.set("returnTo", homeUrl.toString());
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: destination.toString(),
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
