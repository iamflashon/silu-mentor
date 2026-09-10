import { corsHeaders, originOf } from "../../../lib/student-mcp-auth";

export async function GET(request: Request) {
  const origin = originOf(request);
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["resources.read", "progress.read", "progress.write"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/mcp/connect`,
  }, { headers: corsHeaders(request) });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
