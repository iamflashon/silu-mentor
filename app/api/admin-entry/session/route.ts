import { isAdminEntryAuthenticated } from "../../../../lib/admin-entry-auth";
import { authenticatedEmail } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const authenticated = await isAdminEntryAuthenticated(request);
  const identityPresent = Boolean(authenticatedEmail(request));
  return Response.json({
    authenticated,
    identityPresent,
    member: authenticated ? { displayName: "管理員", email: "admin", role: "teacher", canAdmin: true, status: "active" } : null,
  }, { headers: { "cache-control": "no-store" } });
}
