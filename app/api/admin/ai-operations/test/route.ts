import { env } from "cloudflare:workers";
import { requireAdmin } from "../../../../../lib/member-auth";
import { recordPlatformUsage } from "../../../../../lib/platform-metering";

function rpcPayload(text: string) {
  if (!text.trim()) return {};
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find((line) => line && line !== "[DONE]");
  return JSON.parse(data || text) as { result?: { tools?: Array<{ name?: string; description?: string }> }; error?: { message?: string } };
}

async function rpc(url: string, headers: Headers, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 180)}`);
    return { payload: rpcPayload(text), sessionId: response.headers.get("mcp-session-id") || "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const database = (env as unknown as { DB: D1Database }).DB;
  const { serverId } = await request.json() as { serverId?: string };
  const server = await database.prepare(`SELECT * FROM mcp_servers WHERE id=? LIMIT 1`).bind(String(serverId ?? "")).first<Record<string, unknown>>();
  if (!server) return Response.json({ error: "找不到 MCP Server" }, { status: 404 });
  const started = Date.now();
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });
  if (server.auth_type === "bearer") {
    const key = String(server.secret_env_key || "");
    const token = String((env as unknown as Record<string, unknown>)[key] ?? "");
    if (!token) return Response.json({ error: `尚未設定 ${key} 執行環境密鑰` }, { status: 400 });
    headers.set("authorization", `Bearer ${token}`);
  }

  try {
    const initialize = await rpc(String(server.endpoint_url), headers, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "iBrain AI Operations", version: "1.0.0" } } }, Number(server.timeout_ms));
    if (initialize.payload.error) throw new Error(initialize.payload.error.message || "MCP 初始化失敗");
    headers.set("mcp-protocol-version", "2025-06-18");
    if (initialize.sessionId) headers.set("mcp-session-id", initialize.sessionId);
    await rpc(String(server.endpoint_url), headers, { jsonrpc: "2.0", method: "notifications/initialized" }, Number(server.timeout_ms));
    const listed = await rpc(String(server.endpoint_url), headers, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, Number(server.timeout_ms));
    if (listed.payload.error) throw new Error(listed.payload.error.message || "無法讀取工具清單");
    const tools = listed.payload.result?.tools ?? [];
    const statements = tools.filter((tool) => tool.name).map((tool) => database.prepare(`INSERT INTO mcp_tool_policies (id,server_id,tool_name,description,enabled,require_approval,allowed_roles_json,credit_cost,call_cost_usd_micros,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?,?,unixepoch(),unixepoch()) ON CONFLICT(server_id,tool_name) DO UPDATE SET description=excluded.description,updated_at=excluded.updated_at`).bind(
      crypto.randomUUID(), server.id, tool.name, tool.description || "", String(server.allowed_roles_json), Number(server.default_credit_cost), Number(server.default_call_cost_usd_micros),
    ));
    if (statements.length) await database.batch(statements);
    await database.prepare(`UPDATE mcp_servers SET last_health_status='healthy',last_health_message=?,last_health_at=unixepoch(),consecutive_failures=0,updated_at=unixepoch() WHERE id=?`).bind(`已連線，發現 ${tools.length} 個工具`, server.id).run();
    await recordPlatformUsage({ memberId: auth.member.id, userKey: auth.userKey, category: "mcp", provider: String(server.name), resource: "__healthcheck", source: "管理員連線測試", durationMs: Date.now() - started });
    return Response.json({ healthy: true, toolCount: tools.length, tools: tools.map((tool) => tool.name) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP 連線失敗";
    await database.prepare(`UPDATE mcp_servers SET last_health_status='failed',last_health_message=?,last_health_at=unixepoch(),consecutive_failures=consecutive_failures+1,updated_at=unixepoch() WHERE id=?`).bind(message.slice(0, 500), server.id).run();
    await recordPlatformUsage({ memberId: auth.member.id, userKey: auth.userKey, category: "mcp", provider: String(server.name), resource: "__healthcheck", source: "管理員連線測試", durationMs: Date.now() - started, status: "failed", errorCode: "MCP_HEALTHCHECK_FAILED" });
    return Response.json({ healthy: false, error: message }, { status: 502 });
  }
}
