import { cleanText, corsHeaders, mcpDatabase, sha256, validRedirectUri } from "../../../lib/student-mcp-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
      return Response.json({ error: "invalid_client_metadata", error_description: "Only public PKCE clients are supported" }, { status: 400, headers: corsHeaders(request) });
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? [...new Set(body.redirect_uris.map(validRedirectUri).filter(Boolean))].slice(0, 5)
      : [];
    if (!redirectUris.length) return Response.json({ error: "invalid_redirect_uri" }, { status: 400, headers: corsHeaders(request) });
    const clientName = cleanText(body.client_name, 120) || "ChatGPT";
    const clientId = `mcp_${(await sha256(JSON.stringify([clientName, ...redirectUris]))).slice(0, 32)}`;
    await mcpDatabase().prepare(`INSERT INTO mcp_oauth_clients (client_id,client_name,redirect_uris_json,status,created_at,updated_at) VALUES (?,?,?,'active',unixepoch(),unixepoch()) ON CONFLICT(client_id) DO UPDATE SET client_name=excluded.client_name,redirect_uris_json=excluded.redirect_uris_json,status='active',updated_at=unixepoch()`).bind(
      clientId, clientName, JSON.stringify(redirectUris),
    ).run();
    return Response.json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, { status: 201, headers: corsHeaders(request) });
  } catch {
    return Response.json({ error: "invalid_client_metadata" }, { status: 400, headers: corsHeaders(request) });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
