import { cleanText, corsHeaders, mcpDatabase, pkceChallenge, randomToken, sha256 } from "../../../lib/student-mcp-auth";

function oauthError(request: Request, error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status, headers: corsHeaders(request) });
}

async function issueTokens(db: D1Database, clientId: string, memberId: number, scope: string) {
  const accessToken = randomToken("ibrain_at");
  const refreshToken = randomToken("ibrain_rt");
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO mcp_oauth_tokens (id,access_token_hash,refresh_token_hash,client_id,member_id,scope,access_expires_at,refresh_expires_at,created_at) VALUES (?,?,?,?,?,?,unixepoch()+3600,unixepoch()+2592000,unixepoch())`).bind(
    id, await sha256(accessToken), await sha256(refreshToken), clientId, memberId, scope,
  ).run();
  return { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope };
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return oauthError(request, "invalid_request", "Form body is required");
  const grantType = cleanText(form.get("grant_type"), 50);
  const clientId = cleanText(form.get("client_id"), 160);
  const db = mcpDatabase();

  if (grantType === "authorization_code") {
    const code = cleanText(form.get("code"), 300);
    const redirectUri = cleanText(form.get("redirect_uri"), 1000);
    const verifier = cleanText(form.get("code_verifier"), 180);
    if (!clientId || !code || !redirectUri || verifier.length < 43) return oauthError(request, "invalid_request", "Missing authorization code or PKCE verifier");
    const row = await db.prepare(`SELECT code_hash AS codeHash,client_id AS clientId,member_id AS memberId,redirect_uri AS redirectUri,scope,code_challenge AS codeChallenge FROM mcp_oauth_authorization_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>unixepoch() LIMIT 1`).bind(await sha256(code)).first<Record<string, unknown>>();
    if (!row || String(row.clientId) !== clientId || String(row.redirectUri) !== redirectUri || await pkceChallenge(verifier) !== String(row.codeChallenge)) {
      return oauthError(request, "invalid_grant", "Authorization code is invalid or expired");
    }
    const consumed = await db.prepare("UPDATE mcp_oauth_authorization_codes SET used_at=unixepoch() WHERE code_hash=? AND used_at IS NULL").bind(String(row.codeHash)).run();
    if (!consumed.meta.changes) return oauthError(request, "invalid_grant", "Authorization code was already used");
    return Response.json(await issueTokens(db, clientId, Number(row.memberId), String(row.scope)), { headers: corsHeaders(request) });
  }

  if (grantType === "refresh_token") {
    const refreshToken = cleanText(form.get("refresh_token"), 300);
    if (!clientId || !refreshToken) return oauthError(request, "invalid_request", "Missing refresh token");
    const row = await db.prepare(`SELECT id,client_id AS clientId,member_id AS memberId,scope FROM mcp_oauth_tokens WHERE refresh_token_hash=? AND revoked_at IS NULL AND refresh_expires_at>unixepoch() LIMIT 1`).bind(await sha256(refreshToken)).first<Record<string, unknown>>();
    if (!row || String(row.clientId) !== clientId) return oauthError(request, "invalid_grant", "Refresh token is invalid or expired");
    const revoked = await db.prepare("UPDATE mcp_oauth_tokens SET revoked_at=unixepoch() WHERE id=? AND revoked_at IS NULL").bind(String(row.id)).run();
    if (!revoked.meta.changes) return oauthError(request, "invalid_grant", "Refresh token was already used");
    return Response.json(await issueTokens(db, clientId, Number(row.memberId), String(row.scope)), { headers: corsHeaders(request) });
  }

  return oauthError(request, "unsupported_grant_type", "Use authorization_code or refresh_token");
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
