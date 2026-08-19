import { isAdminEntryAuthenticated } from "../../../../lib/admin-entry-auth";

export async function GET(request: Request) {
  const authenticated = await isAdminEntryAuthenticated(request);
  return Response.json({
    authenticated,
    member: authenticated ? { displayName: "管理員", email: "admin", role: "teacher", canAdmin: true, status: "active" } : null,
  }, { headers: { "cache-control": "no-store" } });
}
