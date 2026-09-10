import { env } from "cloudflare:workers";
import { requireAdmin } from "../../../../lib/member-auth";

type ServerInput = {
  id?: string;
  name?: string;
  description?: string;
  endpointUrl?: string;
  authType?: "none" | "bearer";
  secretEnvKey?: string;
  status?: "active" | "disabled";
  allowedRoles?: string[];
  monthlyBudgetUsd?: number;
  defaultCreditCost?: number;
  defaultCallCostUsd?: number;
  timeoutMs?: number;
};

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function roles(value: unknown) {
  const allowed = new Set(["student", "teacher", "admin"]);
  const selected = Array.isArray(value) ? value.filter((role): role is string => typeof role === "string" && allowed.has(role)) : [];
  return [...new Set(selected.length ? selected : ["admin"] )];
}

function parseServerUrl(value: unknown) {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("MCP 位址必須使用 HTTPS");
  }
  return url.toString();
}

function periodDays(value: string | null) {
  const days = Number(value);
  return days === 7 || days === 90 ? days : 30;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const database = (env as unknown as { DB: D1Database }).DB;
  const days = periodDays(new URL(request.url).searchParams.get("days"));
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);

  try {
    const [legacy, platform, servers, tools, recent, models, revenue, entitlements, settings] = await Promise.all([
      database.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(cached_tokens),0) AS cachedTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(estimated_cost_usd_micros),0) AS costMicros FROM usage_logs WHERE created_at >= ?`).bind(since).first(),
      database.prepare(`SELECT COUNT(*) AS events, COALESCE(SUM(CASE WHEN category='mcp' THEN call_count ELSE 0 END),0) AS mcpCalls, COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failures, COUNT(DISTINCT CASE WHEN user_key!='anonymous' THEN user_key END) AS activeUsers, COALESCE(SUM(estimated_cost_usd_micros),0) AS meteredCostMicros FROM platform_usage_events WHERE created_at >= ?`).bind(since).first(),
      database.prepare(`SELECT id,name,description,endpoint_url AS endpointUrl,auth_type AS authType,secret_env_key AS secretEnvKey,status,allowed_roles_json AS allowedRolesJson,monthly_budget_usd_micros AS monthlyBudgetUsdMicros,default_credit_cost AS defaultCreditCost,default_call_cost_usd_micros AS defaultCallCostUsdMicros,timeout_ms AS timeoutMs,last_health_status AS lastHealthStatus,last_health_message AS lastHealthMessage,last_health_at AS lastHealthAt,consecutive_failures AS consecutiveFailures FROM mcp_servers ORDER BY status DESC,name`).all(),
      database.prepare(`SELECT id,server_id AS serverId,tool_name AS toolName,description,enabled,require_approval AS requireApproval,allowed_roles_json AS allowedRolesJson,credit_cost AS creditCost,call_cost_usd_micros AS callCostUsdMicros FROM mcp_tool_policies ORDER BY server_id,tool_name`).all(),
      database.prepare(`SELECT id,user_key AS userKey,category,provider,resource,source,input_tokens AS inputTokens,output_tokens AS outputTokens,call_count AS callCount,credit_delta AS creditDelta,estimated_cost_usd_micros AS estimatedCostUsdMicros,duration_ms AS durationMs,status,error_code AS errorCode,created_at AS createdAt FROM platform_usage_events ORDER BY created_at DESC LIMIT 40`).all(),
      database.prepare(`SELECT model,COUNT(*) AS requests,COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,COALESCE(SUM(estimated_cost_usd_micros),0) AS costMicros FROM usage_logs WHERE created_at >= ? GROUP BY model ORDER BY costMicros DESC LIMIT 8`).bind(since).all(),
      database.prepare(`SELECT COUNT(*) AS paidOrders,COALESCE(SUM(amount),0) AS revenueTwd FROM ai_payment_orders WHERE status='paid' AND paid_at >= ?`).bind(since).first(),
      database.prepare(`SELECT COUNT(DISTINCT member_id) AS activeEntitlements FROM ai_access_entitlements WHERE status='active' AND expires_at >= unixepoch()`).first(),
      database.prepare(`SELECT value FROM app_settings WHERE key='ai_operations_monthly_budget_usd' LIMIT 1`).first(),
    ]);

    return Response.json({
      periodDays: days,
      summary: { ...legacy, ...platform, ...revenue, ...entitlements },
      monthlyBudgetUsd: Number(settings?.value ?? 100),
      monthSpendMicros: Number((await database.prepare(`SELECT COALESCE(SUM(estimated_cost_usd_micros),0) AS value FROM usage_logs WHERE created_at >= ?`).bind(monthStart).first())?.value ?? 0),
      servers: servers.results.map((server) => ({ ...server, allowedRoles: JSON.parse(String(server.allowedRolesJson || "[]")) })),
      tools: tools.results.map((tool) => ({ ...tool, enabled: Boolean(tool.enabled), requireApproval: Boolean(tool.requireApproval), allowedRoles: JSON.parse(String(tool.allowedRolesJson || "[]")) })),
      recent: recent.results,
      models: models.results,
    });
  } catch (error) {
    return Response.json({ error: "AI／MCP 營運資料尚未完成資料庫更新", detail: error instanceof Error ? error.message : "database unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const database = (env as unknown as { DB: D1Database }).DB;
  const body = await request.json() as { action?: string; server?: ServerInput; monthlyBudgetUsd?: number; tool?: Record<string, unknown> };

  if (body.action === "set_budget") {
    const budget = clamp(body.monthlyBudgetUsd, 1, 1_000_000, 100);
    await database.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES ('ai_operations_monthly_budget_usd',?,unixepoch()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(budget)).run();
    return Response.json({ saved: true, monthlyBudgetUsd: budget });
  }

  if (body.action === "save_tool") {
    const tool = body.tool ?? {};
    const id = String(tool.id ?? "").trim();
    if (!id) return Response.json({ error: "找不到 MCP 工具" }, { status: 400 });
    await database.prepare(`UPDATE mcp_tool_policies SET enabled=?,require_approval=?,allowed_roles_json=?,credit_cost=?,call_cost_usd_micros=?,updated_at=unixepoch() WHERE id=?`).bind(
      tool.enabled === false ? 0 : 1,
      tool.requireApproval === true ? 1 : 0,
      JSON.stringify(roles(tool.allowedRoles)),
      Math.round(clamp(tool.creditCost, 0, 10_000, 1)),
      Math.round(clamp(tool.callCostUsd, 0, 100_000, 0) * 1_000_000),
      id,
    ).run();
    return Response.json({ saved: true });
  }

  const input = body.server ?? {};
  try {
    const id = input.id?.trim() || crypto.randomUUID();
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) return Response.json({ error: "請輸入 MCP 名稱" }, { status: 400 });
    const endpointUrl = parseServerUrl(input.endpointUrl);
    const secretEnvKey = String(input.secretEnvKey ?? "").trim().toUpperCase();
    if (secretEnvKey && !/^[A-Z][A-Z0-9_]{2,79}$/.test(secretEnvKey)) return Response.json({ error: "密鑰變數名稱格式不正確" }, { status: 400 });
    await database.prepare(`
      INSERT INTO mcp_servers (id,name,description,endpoint_url,auth_type,secret_env_key,status,allowed_roles_json,monthly_budget_usd_micros,default_credit_cost,default_call_cost_usd_micros,timeout_ms,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,endpoint_url=excluded.endpoint_url,auth_type=excluded.auth_type,secret_env_key=excluded.secret_env_key,status=excluded.status,allowed_roles_json=excluded.allowed_roles_json,monthly_budget_usd_micros=excluded.monthly_budget_usd_micros,default_credit_cost=excluded.default_credit_cost,default_call_cost_usd_micros=excluded.default_call_cost_usd_micros,timeout_ms=excluded.timeout_ms,updated_at=unixepoch()
    `).bind(
      id, name, String(input.description ?? "").trim().slice(0, 500), endpointUrl,
      input.authType === "bearer" ? "bearer" : "none", secretEnvKey,
      input.status === "disabled" ? "disabled" : "active", JSON.stringify(roles(input.allowedRoles)),
      Math.round(clamp(input.monthlyBudgetUsd, 0, 1_000_000, 0) * 1_000_000),
      Math.round(clamp(input.defaultCreditCost, 0, 10_000, 1)),
      Math.round(clamp(input.defaultCallCostUsd, 0, 100_000, 0) * 1_000_000),
      Math.round(clamp(input.timeoutMs, 3_000, 60_000, 15_000)),
    ).run();
    return Response.json({ saved: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "無法儲存 MCP" }, { status: 400 });
  }
}
