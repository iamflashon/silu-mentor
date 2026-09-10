import { corsHeaders, originOf } from "../../../lib/student-mcp-auth";

export async function GET(request: Request) {
  const origin = originOf(request);
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/mcp/token`,
    registration_endpoint: `${origin}/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["resources.read", "progress.read", "progress.write"],
  }, { headers: corsHeaders(request) });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
