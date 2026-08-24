import { clearAdminEntryCookie } from "../../../../lib/admin-entry-auth";

export async function POST() {
  return new Response(null, {
    status: 303,
    headers: {
      location: "/cdn-cgi/access/logout",
      "cache-control": "no-store",
      "set-cookie": clearAdminEntryCookie(),
    },
  });
}
