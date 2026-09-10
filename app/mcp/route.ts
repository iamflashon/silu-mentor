import { searchExternalCatalog } from "../../lib/external-catalog-search";
import { recordPlatformUsage } from "../../lib/platform-metering";
import { authenticateMcp, cleanText, corsHeaders, hasScope, mcpDailyCallLimit, mcpDatabase, unauthorizedMcp, type McpIdentity } from "../../lib/student-mcp-auth";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
type ToolDefinition = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> };

const tools: ToolDefinition[] = [
  {
    name: "search_gaodian_resources",
    title: "搜尋高點學習資源",
    description: "依考試、科目、老師或主題搜尋平台已審核並發布的高點教材、課程、題庫或公開索引。只回傳真實命中與來源網址；規劃備考資源前應先使用此工具。",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 120, description: "例如：司律二試行政法 彭狸、會研所中級會計、醫檢病毒學" }, limit: { type: "integer", minimum: 1, maximum: 8, default: 5 } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, untrustedContentHint: true },
  },
  {
    name: "get_exam_progress",
    title: "讀取備考進度",
    description: "讀取目前學生最近的學習紀錄、弱點、下一步與陪考打卡。要接續昨日進度或制定今天任務時使用。",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 60, default: 14 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, untrustedContentHint: false },
  },
  {
    name: "save_coaching_checkin",
    title: "保存陪考打卡",
    description: "在學生明確同意保存本次進度時，記錄今日完成內容、弱點和下一個行動。不要在一般問答或學生尚未確認時呼叫。",
    inputSchema: { type: "object", properties: { summary: { type: "string", minLength: 2, maxLength: 500 }, weak_spot: { type: "string", maxLength: 300 }, next_action: { type: "string", maxLength: 300 }, completed_tasks: { type: "integer", minimum: 0, maximum: 100, default: 0 } }, required: ["summary"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
  },
];

function rpc(id: RpcRequest["id"], result: unknown, request: Request, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status, headers: { ...corsHeaders(request), "mcp-protocol-version": "2025-06-18" } });
}

function rpcError(id: RpcRequest["id"], code: number, message: string, request: Request, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers: { ...corsHeaders(request), "mcp-protocol-version": "2025-06-18" } });
}

function toolResult(data: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

async function withinDailyLimit(identity: McpIdentity) {
  const limit = mcpDailyCallLimit();
  const row = await mcpDatabase().prepare(`SELECT COALESCE(SUM(call_count),0) AS calls FROM platform_usage_events WHERE user_key=? AND category='mcp' AND provider='iBrain Student MCP' AND created_at>=unixepoch('now','start of day')`).bind(identity.email).first<{ calls?: number }>();
  return { allowed: Number(row?.calls || 0) < limit, limit };
}

async function callTool(name: string, args: Record<string, unknown>, identity: McpIdentity) {
  const started = Date.now();
  const requiredScope: "resources.read" | "progress.read" | "progress.write" = name === "search_gaodian_resources" ? "resources.read" : name === "get_exam_progress" ? "progress.read" : "progress.write";
  if (!hasScope(identity, requiredScope)) return toolResult({ error: "這次授權不包含此工具需要的權限。" }, true);
  const quota = await withinDailyLimit(identity);
  if (!quota.allowed) return toolResult({ error: `今天已達 ${quota.limit} 次 MCP 呼叫上限，請明天再試。` }, true);
  try {
    let data: unknown;
    if (name === "search_gaodian_resources") {
      const query = cleanText(args.query, 120);
      const limit = Math.max(1, Math.min(8, Number(args.limit) || 5));
      if (query.length < 2) return toolResult({ error: "搜尋內容至少需要兩個字。" }, true);
      const rows = await searchExternalCatalog(query, limit);
      data = {
        query,
        count: rows.length,
        results: rows.map((row) => ({ title: row.title, collection: row.source, parent_title: row.parentTitle, summary: row.summary, url: row.url, relevance_score: row.score })),
        guidance: rows.length ? "只能依以上命中資料推薦，請附上來源網址。" : "沒有找到已發布資源；請直接告知學生沒有命中，不要猜測教材名稱。",
      };
    } else if (name === "get_exam_progress") {
      const days = Math.max(1, Math.min(60, Number(args.days) || 14));
      const db = mcpDatabase();
      const [records, checkins] = await Promise.all([
        db.prepare(`SELECT record_date AS recordDate,subject,title,activity_type AS activityType,actual_minutes AS actualMinutes,correct,reflection,weakness,next_step AS nextStep FROM study_records WHERE user_key=? AND created_at>=unixepoch()-?*86400 ORDER BY created_at DESC LIMIT 40`).bind(identity.email, days).all(),
        db.prepare(`SELECT summary,weak_spot AS weakSpot,next_action AS nextAction,completed_tasks AS completedTasks,created_at AS createdAt FROM mcp_coach_checkins WHERE member_id=? AND created_at>=unixepoch()-?*86400 ORDER BY created_at DESC LIMIT 20`).bind(identity.memberId, days).all(),
      ]);
      data = { student: identity.name || identity.email, period_days: days, learning_records: records.results || [], coaching_checkins: checkins.results || [], guidance: "請先承接未完成項目與最新弱點，一次安排一個可完成的下一步。" };
    } else if (name === "save_coaching_checkin") {
      const summary = cleanText(args.summary, 500);
      if (summary.length < 2) return toolResult({ error: "請提供本次完成內容。" }, true);
      const row = { id: crypto.randomUUID(), summary, weakSpot: cleanText(args.weak_spot, 300), nextAction: cleanText(args.next_action, 300), completedTasks: Math.max(0, Math.min(100, Number(args.completed_tasks) || 0)) };
      await mcpDatabase().prepare(`INSERT INTO mcp_coach_checkins (id,member_id,user_key,summary,weak_spot,next_action,completed_tasks,source,created_at) VALUES (?,?,?,?,?,?,?,'chatgpt_mcp',unixepoch())`).bind(row.id, identity.memberId, identity.email, row.summary, row.weakSpot, row.nextAction, row.completedTasks).run();
      data = { saved: true, checkin: row };
    } else {
      return toolResult({ error: "找不到指定工具。" }, true);
    }
    await recordPlatformUsage({ memberId: identity.memberId, userKey: identity.email, category: "mcp", provider: "iBrain Student MCP", resource: name, source: "學生自有 ChatGPT", callCount: 1, durationMs: Date.now() - started });
    return toolResult(data);
  } catch (error) {
    await recordPlatformUsage({ memberId: identity.memberId, userKey: identity.email, category: "mcp", provider: "iBrain Student MCP", resource: name, source: "學生自有 ChatGPT", callCount: 1, durationMs: Date.now() - started, status: "failed", errorCode: "MCP_TOOL_FAILED" });
    return toolResult({ error: error instanceof Error ? error.message.slice(0, 240) : "工具暫時無法使用" }, true);
  }
}

export async function POST(request: Request) {
  const identity = await authenticateMcp(request);
  if (!identity) return unauthorizedMcp(request);
  let message: RpcRequest;
  try { message = await request.json() as RpcRequest; } catch { return rpcError(null, -32700, "Parse error", request, 400); }
  if (message.jsonrpc !== "2.0" || !message.method) return rpcError(message.id, -32600, "Invalid Request", request, 400);
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return new Response(null, { status: 202, headers: corsHeaders(request) });
  if (message.method === "initialize") return rpc(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "iBrain Exam Advisor", version: "1.0.0" }, instructions: "先搜尋已發布資源再推薦；沒有命中不得虛構。陪考時先讀取進度，每次只安排一個可完成行動；保存紀錄前需取得學生同意。" }, request);
  if (message.method === "ping") return rpc(message.id, {}, request);
  if (message.method === "tools/list") return rpc(message.id, { tools }, request);
  if (message.method === "tools/call") {
    const name = cleanText(message.params?.name, 100);
    if (!tools.some((tool) => tool.name === name)) return rpcError(message.id, -32602, "Unknown tool", request);
    return rpc(message.id, await callTool(name, message.params?.arguments || {}, identity), request);
  }
  return rpcError(message.id, -32601, "Method not found", request);
}

export async function GET(request: Request) {
  const identity = await authenticateMcp(request);
  if (!identity) return unauthorizedMcp(request);
  return Response.json({ name: "iBrain Exam Advisor MCP", protocol: "Streamable HTTP", tools: tools.map((tool) => tool.name) }, { headers: corsHeaders(request) });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
