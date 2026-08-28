import { requireAdmin } from "../../../../lib/member-auth";
import { createSitesCloudflareSyncToken } from "../../../../lib/sites-cloudflare-sync-token";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return Response.json({
    sourceUrl: new URL(request.url).origin,
    sitesUrl: new URL(request.url).origin,
    token: await createSitesCloudflareSyncToken(),
    expiresAt: expiresAt.toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
