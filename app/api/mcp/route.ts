import { getJudicialCaseDetail, searchJudicialCases } from "../../../lib/judicial-search";
import { simulateJudicialResearch } from "../../../lib/judicial-research-simulator";
import { GET as searchLegalArticles } from "../legal-search/route";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { legalArticles, legalDataSources, legalDocuments } from "../../../db/schema";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

const MCP_PROTOCOL_VERSION = "2025-06-18";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function articleOrder(articleNo: string, fallbackId: number) {
  const normalized = articleNo.replace(/\s+/g, "");
  const match = normalized.match(/第(\d+)(?:條)?(?:[-之](\d+))?(?:條)?(?:之(\d+))?/);
  if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, fallbackId];
  return [Number(match[1]), Number(match[2] ?? match[3] ?? 0), fallbackId];
}

function compareLegalArticles(left: { articleNo: string; id: number }, right: { articleNo: string; id: number }) {
  const leftOrder = articleOrder(left.articleNo, left.id);
  const rightOrder = articleOrder(right.articleNo, right.id);
  for (let index = 0; index < leftOrder.length; index += 1) {
    if (leftOrder[index] !== rightOrder[index]) return leftOrder[index] - rightOrder[index];
  }
  return 0;
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), { status, headers: JSON_HEADERS });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), { status, headers: JSON_HEADERS });
}

async function mcpConfiguration() {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as {
    MCP_ENABLED?: string;
    MCP_ACCESS_TOKEN?: string;
    ANGLE_PEDIA_SERVICE_TOKEN?: string;
    MCP_PUBLIC_TEST_ENABLED?: string;
  };
  return {
    enabled: (runtime.MCP_ENABLED ?? process.env.MCP_ENABLED ?? "").trim().toLowerCase() === "true",
    token: (runtime.MCP_ACCESS_TOKEN ?? process.env.MCP_ACCESS_TOKEN ?? "").trim(),
    anglePediaToken: (runtime.ANGLE_PEDIA_SERVICE_TOKEN ?? process.env.ANGLE_PEDIA_SERVICE_TOKEN ?? "").trim(),
    publicTestEnabled:
      (runtime.MCP_PUBLIC_TEST_ENABLED ?? process.env.MCP_PUBLIC_TEST_ENABLED ?? "")
        .trim()
        .toLowerCase() === "true",
  };
}

async function authorize(request: Request) {
  const config = await mcpConfiguration();
  if (!config.enabled) return new Response("MCP 尚未啟用", { status: 503, headers: { "cache-control": "no-store" } });
  // Temporary compatibility switch for ChatGPT developer-mode testing. It is
  // off by default and can be disabled immediately without a code rollback.
  if (config.publicTestEnabled) return null;
  if (!config.token) return new Response("MCP 尚未啟用", { status: 503, headers: { "cache-control": "no-store" } });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (supplied !== config.token && (!config.anglePediaToken || supplied !== config.anglePediaToken)) return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } });
  return null;
}

const tools = [
  {
    name: "research_cases",
    description: "多輪搜尋並建立可稽核的證據包。只有 allowedCitations 內、已經全文檢查的裁判可以引用；其餘候選只能繼續研究。",
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
        any_terms: { type: "string", description: "任一詞命中；以空白或頓號分隔" },
        all_terms: { type: "string", description: "所有詞都必須命中；以空白或頓號分隔" },
        exclude_terms: { type: "string", description: "排除詞；以空白或頓號分隔" },
        person: { type: "string", description: "全文姓名搜尋，不代表已辨識人物角色" },
        court_level: { type: "string", enum: ["", "supreme", "high", "district"] },
        division: { type: "string", enum: ["", "civil", "criminal", "administrative"] },
        case_type: { type: "string", description: "裁判字別，例如：上、台上、訴" },
        date_from: { type: "string", description: "西元起始日期 YYYYMMDD" },
        date_to: { type: "string", description: "西元結束日期 YYYYMMDD" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        offset: { type: "integer", minimum: 0, maximum: 100000, default: 0, description: "相關度排序後略過的筆數，用於分頁" },
        search_mode: { type: "string", enum: ["auto", "keyword", "phrase"], default: "auto", description: "auto 會辨識完整案號並精確調卷；phrase 查完整詞組；keyword 以空白分隔必要概念" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_case_detail",
    description: "依 JID 分頁讀取單篇裁判全文。長裁判請依 nextOffset 繼續讀取，不可把未讀完的裁判標成已核對。",
    annotations: { title: "讀取裁判全文", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        jid: { type: "string", description: "裁判唯一識別碼 JID" },
        offset: { type: "integer", minimum: 0, default: 0, description: "從第幾個字元開始讀取" },
        max_chars: { type: "integer", minimum: 2000, maximum: 50000, default: 12000, description: "本次最多回傳字元數" },
      },
      required: ["jid"],
      additionalProperties: false,
    },
  },
  {
    name: "search_laws",
    description: "搜尋已同步的全國法規資料。回傳法規名稱、條號、條文摘要、異動日期與官方來源，不公開內部擴詞及排序策略。",
    annotations: { title: "搜尋全國法規", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "法規名稱、條號或法律概念，例如：民法第184條" },
        category: { type: "string", enum: ["", "法律", "命令"], default: "" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_law_detail",
    description: "依 document_id 讀取已同步法規的完整現行全文，包含法規基本資料與依條號排列的全部條文。",
    annotations: { title: "讀取完整法規", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "integer", minimum: 1, description: "search_laws 回傳的法規 documentId" },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_legal_data_status",
    description: "取得已同步全國法規資料的法規數、條文數與資料來源就緒狀態。",
    annotations: { title: "全國法規資料狀態", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
      serverInfo: { name: "yuanzhao-legal-database", version: "0.3.0" },
      instructions: "裁判研究先用 research_cases 取得證據包。只有 allowedCitations 內、已全文檢查的裁判可以引用；需要核對原文時，以 get_case_detail 依 JID 分頁讀取。查法規先用 search_laws，再以 get_law_detail 依 document_id 讀取整部法規全文；引用時保留法規名稱、條號、異動日期及官方來源。不得把搜尋不到解讀為法律上不存在。搜尋工具只提供證據資料，不代替法律專業判斷。",
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
        anyTerms: typeof args.any_terms === "string" ? args.any_terms : "",
        allTerms: typeof args.all_terms === "string" ? args.all_terms : "",
        excludeTerms: typeof args.exclude_terms === "string" ? args.exclude_terms : "",
        person: typeof args.person === "string" ? args.person : "",
        courtLevel: typeof args.court_level === "string" ? args.court_level : "",
        division: typeof args.division === "string" ? args.division : "",
        caseType: typeof args.case_type === "string" ? args.case_type : "",
        dateFrom: typeof args.date_from === "string" ? args.date_from : "",
        dateTo: typeof args.date_to === "string" ? args.date_to : "",
        limit: Math.min(20, Number(args.limit) || 10),
        offset: Math.max(0, Math.min(100000, Math.floor(Number(args.offset) || 0))),
        searchMode: args.search_mode === "keyword" || args.search_mode === "phrase" ? args.search_mode : "auto",
      });
      const compact = { ...result, results: result.results.map(({ fullText: _fullText, ...item }) => item) };
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(compact) }], structuredContent: compact });
    }
    if (name === "get_case_detail") {
      const jid = typeof args.jid === "string" ? args.jid : "";
      if (!jid) return rpcError(body.id, -32602, "jid is required");
      const result = await getJudicialCaseDetail(jid, {
        offset: Math.max(0, Number(args.offset) || 0),
        maxChars: Math.max(2_000, Math.min(50_000, Number(args.max_chars) || 12_000)),
      });
      if (!result) return rpcResult(body.id, { isError: true, content: [{ type: "text", text: "找不到這筆裁判。" }] });
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    if (name === "search_laws") {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 120) : "";
      if (query.length < 2) return rpcError(body.id, -32602, "query is required");
      const category = args.category === "法律" || args.category === "命令" ? args.category : "";
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
      const params = new URLSearchParams({ query, q: query, category, limit: String(limit) });
      const response = await searchLegalArticles(new Request(`https://mcp.internal/api/legal-search?${params}`));
      const payload = await response.json() as { error?: string; query?: string; total?: number; results?: unknown[] };
      if (!response.ok) return rpcResult(body.id, { isError: true, content: [{ type: "text", text: payload.error || "法規資料搜尋失敗。" }] });
      const compact = { query: payload.query || query, total: Number(payload.total || 0), returned: payload.results?.length || 0, results: payload.results || [] };
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(compact) }], structuredContent: compact });
    }
    if (name === "get_law_detail") {
      const documentId = Math.floor(Number(args.document_id));
      if (!Number.isSafeInteger(documentId) || documentId < 1) return rpcError(body.id, -32602, "document_id is required");
      const db = await getDb("primary");
      const [document] = await db.select().from(legalDocuments).where(and(
        eq(legalDocuments.id, documentId),
        eq(legalDocuments.status, "active"),
      )).limit(1);
      if (!document) return rpcResult(body.id, { isError: true, content: [{ type: "text", text: "找不到這部法規。" }] });
      const articles = (await db.select({
        id: legalArticles.id,
        articleNo: legalArticles.articleNo,
        hierarchy: legalArticles.hierarchy,
        content: legalArticles.content,
      }).from(legalArticles).where(eq(legalArticles.documentId, documentId))).sort(compareLegalArticles);
      const result = {
        documentId: document.id,
        title: document.title,
        category: document.category,
        classification: document.classification,
        modifiedDate: document.modifiedDate,
        effectiveDate: document.effectiveDate,
        history: document.history,
        sourceUrl: document.sourceUrl,
        articleCount: articles.length,
        articles,
        fullText: articles.map((article) => [article.hierarchy, article.articleNo, article.content].filter(Boolean).join("\n")).join("\n\n"),
      };
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    if (name === "get_legal_data_status") {
      const db = await getDb("primary");
      const [[documents], [articles], sources] = await Promise.all([
        db.select({ value: sql<number>`count(*)` }).from(legalDocuments).where(eq(legalDocuments.status, "active")),
        db.select({ value: sql<number>`count(*)` }).from(legalArticles),
        db.select({ status: legalDataSources.status }).from(legalDataSources),
      ]);
      const status = {
        documents: Number(documents?.value || 0),
        articles: Number(articles?.value || 0),
        sourcesReady: sources.filter((source) => source.status === "ready").length,
        sourcesTotal: sources.length,
      };
      return rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status });
    }
    return rpcError(body.id, -32602, "Unknown tool");
  } catch {
    return rpcResult(body.id, { isError: true, content: [{ type: "text", text: "法律資料服務暫時無法使用。" }] });
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

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, POST, OPTIONS",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
      "access-control-max-age": "86400",
    },
  });
}
