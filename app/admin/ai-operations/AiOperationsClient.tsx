"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ai-operations.module.css";

type Server = {
  id: string; name: string; description: string; endpointUrl: string; authType: string; secretEnvKey: string;
  status: string; allowedRoles: string[]; monthlyBudgetUsdMicros: number; defaultCreditCost: number;
  defaultCallCostUsdMicros: number; timeoutMs: number; lastHealthStatus: string; lastHealthMessage: string;
  lastHealthAt: number | null; consecutiveFailures: number;
};
type Tool = { id: string; serverId: string; toolName: string; description: string; enabled: boolean; requireApproval: boolean; allowedRoles: string[]; creditCost: number; callCostUsdMicros: number };
type Data = {
  periodDays: number;
  monthlyBudgetUsd: number;
  monthSpendMicros: number;
  summary: { requests?: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number; costMicros?: number; events?: number; mcpCalls?: number; failures?: number; activeUsers?: number; paidOrders?: number; revenueTwd?: number; activeEntitlements?: number };
  servers: Server[];
  tools: Tool[];
  recent: Array<{ id: string; userKey: string; category: string; provider: string; resource: string; source: string; inputTokens: number; outputTokens: number; callCount: number; creditDelta: number; estimatedCostUsdMicros: number; durationMs: number; status: string; errorCode: string; createdAt: number }>;
  models: Array<{ model: string; requests: number; tokens: number; costMicros: number }>;
};

const emptyServer = { name: "", description: "", endpointUrl: "", authType: "none", secretEnvKey: "", allowedRoles: ["student", "teacher", "admin"], monthlyBudgetUsd: 20, defaultCreditCost: 1, defaultCallCostUsd: 0, timeoutMs: 15000 };
const roleLabels: Record<string, string> = { student: "學生", teacher: "老師", admin: "管理員" };
function usd(micros = 0) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(micros) / 1_000_000); }
function integer(value = 0) { return new Intl.NumberFormat("zh-TW").format(Number(value)); }
function dateTime(value: number | null) { return value ? new Date(value * 1000).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "尚未測試"; }

export default function AiOperationsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [serverForm, setServerForm] = useState(emptyServer);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async (selectedDays: number) => {
    setLoading(true);
    const response = await fetch(`/api/admin/ai-operations?days=${selectedDays}`, { cache: "no-store" });
    const payload = await response.json() as Data & { error?: string };
    setLoading(false);
    if (!response.ok) { setNotice(payload.error || "暫時無法讀取營運資料"); return; }
    setData(payload);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/ai-operations?days=${days}`, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as Data & { error?: string } }))
      .then(({ response, payload }) => {
        if (!active) return;
        setLoading(false);
        if (!response.ok) { setNotice(payload.error || "暫時無法讀取營運資料"); return; }
        setData(payload);
      })
      .catch(() => { if (active) { setLoading(false); setNotice("暫時無法讀取營運資料"); } });
    return () => { active = false; };
  }, [days]);

  const budgetRatio = useMemo(() => data ? Math.min(100, data.monthSpendMicros / Math.max(1, data.monthlyBudgetUsd * 1_000_000) * 100) : 0, [data]);

  async function saveServer(event: FormEvent) {
    event.preventDefault(); setBusyId("new"); setNotice("");
    const response = await fetch("/api/admin/ai-operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_server", server: serverForm }) });
    const payload = await response.json() as { error?: string }; setBusyId("");
    if (!response.ok) return setNotice(payload.error || "無法儲存 MCP");
    setServerForm(emptyServer); setShowForm(false); setNotice("MCP 已加入；請執行連線測試取得工具清單。"); void load(days);
  }

  async function toggleServer(server: Server) {
    setBusyId(server.id);
    await fetch("/api/admin/ai-operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_server", server: { ...server, status: server.status === "active" ? "disabled" : "active", monthlyBudgetUsd: server.monthlyBudgetUsdMicros / 1_000_000, defaultCallCostUsd: server.defaultCallCostUsdMicros / 1_000_000 } }) });
    setBusyId(""); void load(days);
  }

  async function testServer(server: Server) {
    setBusyId(`test-${server.id}`); setNotice("");
    const response = await fetch("/api/admin/ai-operations/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serverId: server.id }) });
    const payload = await response.json() as { toolCount?: number; error?: string }; setBusyId("");
    setNotice(response.ok ? `${server.name} 連線成功，已同步 ${payload.toolCount ?? 0} 個工具。` : `${server.name}：${payload.error || "連線失敗"}`); void load(days);
  }

  async function saveTool(tool: Tool, patch: Partial<Tool>) {
    setBusyId(tool.id);
    await fetch("/api/admin/ai-operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_tool", tool: { ...tool, ...patch, callCostUsd: (patch.callCostUsdMicros ?? tool.callCostUsdMicros) / 1_000_000 } }) });
    setBusyId(""); void load(days);
  }

  async function saveBudget(value: number) {
    await fetch("/api/admin/ai-operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_budget", monthlyBudgetUsd: value }) });
    setNotice("平台月預算已更新。"); void load(days);
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><span className={styles.mark}>智</span><div><b>iBrain AI</b><small>AI／MCP 營運中心</small></div></div>
      <nav><Link href="/law">學生聊天入口</Link><Link href="/admin">管理後台</Link></nav>
    </header>

    <section className={styles.heading}>
      <div><p>AI OPERATIONS</p><h1>每一次回答，都看得見成本與權限</h1><span>統一管理考試顧問、陪考教練使用的模型、MCP 工具、點數與健康狀態。</span></div>
      <div className={styles.period}>{[7, 30, 90].map((value) => <button className={days === value ? styles.active : ""} onClick={() => setDays(value)} key={value}>{value} 天</button>)}</div>
    </section>

    {notice && <div className={styles.notice} role="status">{notice}<button onClick={() => setNotice("")} aria-label="關閉通知">×</button></div>}
    {loading && !data ? <div className={styles.loading}>正在整理最新用量…</div> : data ? <>
      <section className={styles.metrics}>
        <article><span>模型請求</span><strong>{integer(data.summary.requests)}</strong><small>{integer((data.summary.inputTokens || 0) + (data.summary.outputTokens || 0))} tokens</small></article>
        <article><span>MCP 呼叫</span><strong>{integer(data.summary.mcpCalls)}</strong><small>{data.summary.failures ? `${data.summary.failures} 次異常` : "目前無異常"}</small></article>
        <article><span>估算成本</span><strong>{usd(data.summary.costMicros)}</strong><small>近 {days} 天</small></article>
        <article><span>有效方案</span><strong>{integer(data.summary.activeEntitlements)}</strong><small>付款 {integer(data.summary.paidOrders)} 筆 · NT${integer(data.summary.revenueTwd)}</small></article>
      </section>

      <section className={styles.budgetCard}>
        <div><span>本月 AI 預算</span><strong>{usd(data.monthSpendMicros)} <small>/ US${data.monthlyBudgetUsd}</small></strong></div>
        <div className={styles.progress}><i style={{ width: `${budgetRatio}%` }} /></div>
        <label>調整上限（USD）<input type="number" min="1" defaultValue={data.monthlyBudgetUsd} onBlur={(event) => void saveBudget(Number(event.target.value))} /></label>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header><div><p>MCP CONTROL PLANE</p><h2>工具連線與學生權限</h2></div><button className={styles.primary} onClick={() => setShowForm((value) => !value)}>{showForm ? "取消" : "＋ 加入 MCP"}</button></header>
          {showForm && <form className={styles.serverForm} onSubmit={saveServer}>
            <label>名稱<input required value={serverForm.name} onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })} placeholder="例如：高點教材搜尋" /></label>
            <label className={styles.wide}>Streamable HTTP 位址<input required type="url" value={serverForm.endpointUrl} onChange={(e) => setServerForm({ ...serverForm, endpointUrl: e.target.value })} placeholder="https://mcp.example.com/mcp" /></label>
            <label>驗證方式<select value={serverForm.authType} onChange={(e) => setServerForm({ ...serverForm, authType: e.target.value })}><option value="none">無</option><option value="bearer">Bearer 密鑰</option></select></label>
            <label>密鑰變數名稱<input value={serverForm.secretEnvKey} onChange={(e) => setServerForm({ ...serverForm, secretEnvKey: e.target.value })} placeholder="GAODIAN_MCP_TOKEN" /></label>
            <label>每次扣點<input type="number" min="0" value={serverForm.defaultCreditCost} onChange={(e) => setServerForm({ ...serverForm, defaultCreditCost: Number(e.target.value) })} /></label>
            <label>月預算 USD<input type="number" min="0" value={serverForm.monthlyBudgetUsd} onChange={(e) => setServerForm({ ...serverForm, monthlyBudgetUsd: Number(e.target.value) })} /></label>
            <fieldset className={styles.wide}><legend>可使用角色</legend>{Object.entries(roleLabels).map(([role, label]) => <label key={role}><input type="checkbox" checked={serverForm.allowedRoles.includes(role)} onChange={(e) => setServerForm({ ...serverForm, allowedRoles: e.target.checked ? [...serverForm.allowedRoles, role] : serverForm.allowedRoles.filter((item) => item !== role) })} />{label}</label>)}</fieldset>
            <button className={styles.primary} disabled={busyId === "new"}>{busyId === "new" ? "儲存中…" : "儲存 MCP"}</button>
          </form>}
          <div className={styles.serverList}>{data.servers.length ? data.servers.map((server) => <article className={styles.server} key={server.id}>
            <div className={styles.serverMain}><i className={`${styles.health} ${styles[server.lastHealthStatus]}`} /><div><strong>{server.name}</strong><small>{server.endpointUrl}</small></div><em className={server.status === "active" ? styles.enabled : styles.disabled}>{server.status === "active" ? "啟用" : "停用"}</em></div>
            <p>{server.description || "尚未填寫用途說明"}</p>
            <div className={styles.serverMeta}><span>{server.allowedRoles.map((role) => roleLabels[role] || role).join("、")}</span><span>{server.defaultCreditCost} 點／次</span><span>月上限 {usd(server.monthlyBudgetUsdMicros)}</span></div>
            <div className={styles.healthMessage}><b>{server.lastHealthStatus === "healthy" ? "連線正常" : server.lastHealthStatus === "failed" ? "需要處理" : "等待測試"}</b><span>{server.lastHealthMessage} · {dateTime(server.lastHealthAt)}</span></div>
            <div className={styles.actions}><button onClick={() => void testServer(server)} disabled={busyId === `test-${server.id}`}>{busyId === `test-${server.id}` ? "測試中…" : "測試並同步工具"}</button><button onClick={() => void toggleServer(server)} disabled={busyId === server.id}>{server.status === "active" ? "暫停使用" : "重新啟用"}</button></div>
            {data.tools.filter((tool) => tool.serverId === server.id).length > 0 && <div className={styles.tools}>{data.tools.filter((tool) => tool.serverId === server.id).map((tool) => <div key={tool.id}><div><strong>{tool.toolName}</strong><small>{tool.description || "MCP 工具"}</small></div><label><input type="checkbox" checked={tool.enabled} onChange={(event) => void saveTool(tool, { enabled: event.target.checked })} />開放</label><label><input type="checkbox" checked={tool.requireApproval} onChange={(event) => void saveTool(tool, { requireApproval: event.target.checked })} />需確認</label><label className={styles.credit}>扣點<input type="number" min="0" value={tool.creditCost} onChange={(event) => void saveTool(tool, { creditCost: Number(event.target.value) })} /></label></div>)}</div>}
          </article>) : <div className={styles.empty}><b>尚未加入 MCP</b><span>先加入「高點教材搜尋」或其他已完成的 MCP，即可測試並同步工具。</span><button onClick={() => setShowForm(true)}>加入第一個 MCP</button></div>}</div>
        </section>

        <aside className={styles.side}>
          <section className={styles.panel}><header><div><p>MODEL MIX</p><h2>模型成本排行</h2></div></header>{data.models.length ? <div className={styles.modelList}>{data.models.map((model) => <div key={model.model}><div><strong>{model.model}</strong><span>{integer(model.requests)} 次 · {integer(model.tokens)} tokens</span></div><b>{usd(model.costMicros)}</b></div>)}</div> : <div className={styles.miniEmpty}>期間內尚無模型用量</div>}</section>
          <section className={styles.modeCard}><span>學生入口</span><h2>考試顧問＋陪考教練</h2><p>考試顧問搜尋已授權教材與課程；陪考教練延續進度、出題、追蹤弱點。兩種模式共用帳號、點數與 MCP 權限。</p><Link href="/law">開啟學生聊天入口 →</Link></section>
        </aside>
      </div>

      <section className={`${styles.panel} ${styles.activity}`}><header><div><p>RECENT ACTIVITY</p><h2>最近用量事件</h2></div></header>{data.recent.length ? <div className={styles.tableWrap}><table><thead><tr><th>時間</th><th>使用者</th><th>類型</th><th>模型／工具</th><th>狀態</th><th>成本</th></tr></thead><tbody>{data.recent.map((event) => <tr key={event.id}><td>{dateTime(event.createdAt)}</td><td>{event.userKey}</td><td>{event.category === "mcp" ? "MCP" : "模型"}</td><td><b>{event.resource}</b><small>{event.provider}</small></td><td><span className={event.status === "success" ? styles.ok : styles.bad}>{event.status === "success" ? "成功" : "異常"}</span></td><td>{usd(event.estimatedCostUsdMicros)}</td></tr>)}</tbody></table></div> : <div className={styles.miniEmpty}>新版用量帳本會從下一次 AI 或 MCP 呼叫開始累積。</div>}</section>
    </> : null}
  </main>;
}
