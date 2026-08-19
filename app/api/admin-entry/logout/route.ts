import { clearAdminEntryCookie } from "../../../../lib/admin-entry-auth";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "set-cookie": clearAdminEntryCookie() } });
}
