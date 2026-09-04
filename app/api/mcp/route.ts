import { getJudicialCaseDetail, searchJudicialCases } from "../../../lib/judicial-search";
import { simulateJudicialResearch } from "../../../lib/judicial-research-simulator";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

const MCP_PROTOCOL_VERSION = "2025-06-18";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function rpcResult(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), { status, headers: JSON_HEADERS });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), { status, headers: JSON_HEADERS });
}

async function mcpConfiguration() {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as { MCP_ENABLED?: string; MCP_ACCESS_TOKEN?: string };
  return {
    enabled: (runtime.MCP_ENABLED ?? process.env.MCP_ENABLED ?? "").trim().toLowerCase() === "true",
    token: (runtime.MCP_ACCESS_TOKEN ?? process.env.MCP_ACCESS_TOKEN ?? "").trim(),
  };
}

async function authorize(request: Request) {
  const config = await mcpConfiguration();
  if (!config.enabled || !config.token) return new Response("MCP 尚未啟用", { status: 503, headers: { "cache-control": "no-store" } });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (supplied !== config.token) return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } });
  return null;
}

const tools = [
  {
    name: "research_cases",
    description: "模擬法律研究者進行多輪查詢：拆解問題、替換實務用語、交叉查找並將代表性裁判排在前面。",
    annotations: { title: "多輪研究裁判", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "完整的法律研究問題" } },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "search_cases",
    description: "搜尋臺灣司法裁判。清單只回傳案件資料與短摘要，適合先判斷哪些裁判值得深入閱讀。",
    annotations: { title: "搜尋裁判摘要", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "關鍵字、案號或法律爭點" },
        court: { type: "string", description: "法院名稱，可省略" },
        year: { type: "string", description: "民國年度，可省略" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_case_detail",
    description: "依搜尋結果的 JID 讀取單篇裁判全文。只有需要深讀時才呼叫。",
    annotations: { title: "讀取裁判全文", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { jid: { type: "string", description: "裁判唯一識別碼 JID" } },
      required: ["jid"],
      additionalProperties: false,
    },
  },
];

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  let body: JsonRpcRequest;
  try {
    body = await request.json() as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Invalid JSON", 400);
  }
  if (body.jsonrpc !== "2.0" || !body.method) return rpcError(body.id, -32600, "Invalid Request", 400);
  if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (body.method === "initialize") {
    return rpcResult(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "yuanzhao-legal-database", version: "0.1.0" },
      instructions: "先用 research_cases 或 search_cases 取得少量摘要候選，再選最相關的一至兩篇，以 get_case_detail 依 JID 讀取全文。不得把只有單一概念命中的裁判表述成同時處理全部爭點，也不得把搜尋不到解讀為法律上不存在。引用時應保留法院、年度、字別、案號與 JID。",
    });
  }
  if (body.method === "ping") return rpcResult(body.id, {});
  if (body.method === "tools/list") return rpcResult(body.id, { tools });
  if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found");

  const name = body.params?.name ?? "";
  const args = body.params?.arguments ?? {};
  try {
    if (name === "research_cases") {
      const question = typeof args.question === "string" ? args.question.trim() : "";
      if (question.length < 2) return rpcError(body.id, -32602, "question is required");
      const result = await simulateJudicialResearch(question);
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    if (name === "search_cases") {
      const result = await searchJudicialCases({
        query: typeof args.query === "string" ? args.query : "",
        court: typeof args.court === "string" ? args.court : "",
        year: typeof args.year === "string" ? args.year : "",
        limit: Math.min(20, Number(args.limit) || 10),
      });
      const compact = { ...result, results: result.results.map(({ fullText: _fullText, ...item }) => item) };
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(compact) }], structuredContent: compact });
    }
    if (name === "get_case_detail") {
      const jid = typeof args.jid === "string" ? args.jid : "";
      if (!jid) return rpcError(body.id, -32602, "jid is required");
      const result = await getJudicialCaseDetail(jid);
      if (!result) return rpcResult(body.id, { isError: true, content: [{ type: "text", text: "找不到這筆裁判。" }] });
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    return rpcError(body.id, -32602, "Unknown tool");
  } catch {
    return rpcResult(body.id, { isError: true, content: [{ type: "text", text: "裁判資料服務暫時無法使用。" }] });
  }
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return Response.json({ name: "元照集團法律資料庫 MCP", status: "ready", transport: "streamable-http", endpoint: "/api/mcp" }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
}
