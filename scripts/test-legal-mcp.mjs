#!/usr/bin/env node

const endpoint = process.env.LEGAL_MCP_URL;
const token = process.env.LEGAL_MCP_TOKEN;
const query = process.env.LEGAL_MCP_QUERY || "違約金過高如何酌減";

if (!endpoint) {
  console.error("請設定 LEGAL_MCP_URL");
  process.exit(2);
}

let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

const initialized = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "yuanzhao-external-ai-smoke-test", version: "1.0.0" },
});
console.log(`連線成功：${initialized.serverInfo?.name || "unknown"}`);

const listed = await rpc("tools/list", {});
const names = (listed.tools || []).map((tool) => tool.name);
for (const expected of ["research_cases", "search_cases", "get_case_detail"]) {
  if (!names.includes(expected)) throw new Error(`缺少 MCP 工具：${expected}`);
}
console.log(`工具清單正常：${names.join("、")}`);

const searched = await rpc("tools/call", {
  name: "search_cases",
  arguments: { query, limit: 5 },
});
const searchData = searched.structuredContent;
if (!searchData || !Array.isArray(searchData.results)) throw new Error("搜尋結果格式不正確");
if (searchData.results.some((item) => "fullText" in item)) throw new Error("搜尋清單不應回傳全文");
console.log(`摘要搜尋正常：${searchData.results.length} 筆候選`);

const first = searchData.results[0];
if (!first?.jid) {
  console.log("本次查詢沒有候選裁判；連線與工具測試仍已通過");
  process.exit(0);
}

const detailed = await rpc("tools/call", {
  name: "get_case_detail",
  arguments: { jid: first.jid },
});
const caseData = detailed.structuredContent;
if (!caseData?.fullText) throw new Error("指定 JID 未回傳裁判全文");
console.log(`全文讀取正常：${caseData.jid}，共 ${caseData.fullText.length.toLocaleString("zh-TW")} 字`);
console.log("外部 AI MCP 基本流程測試通過");
