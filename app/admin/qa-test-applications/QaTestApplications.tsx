"use client";

import { useEffect, useState } from "react";
import CentralAdminTabs from "../CentralAdminTabs";

type Row = {
  id: number; deviceKey: string; displayName: string; email: string; reason: string;
  status: string; grantCount: number; requestedAt: number; resolvedAt: number | null;
  resolvedBy: string; usedCount: number; bonusCount: number; deviceStatus: string; ipHash: string;
};

export default function QaTestApplications() {
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const [grant, setGrant] = useState<Record<number, number>>({});

  async function load() {
    const response = await fetch("/api/admin/accounting-qa-requests", { cache: "no-store" });
    const data = await response.json() as { requests?: Row[]; error?: string };
    if (response.ok) setRows(data.requests || []);
    else setNotice(data.error || "讀取失敗");
  }

  useEffect(() => { void load(); }, []);

  async function act(id: number, action: string) {
    setNotice("處理中…");
    const response = await fetch("/api/admin/accounting-qa-requests", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, grantCount: grant[id] || 10 }),
    });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? "申請已更新。" : data.error || "操作失敗");
    if (response.ok) await load();
  }

  return <main className="admin-shell independent-admin-shell qa-admin-page">
    <header className="topbar">
      <a href="/platform" className="brand"><span className="brand-mark">智</span><span>iBrain AI</span></a>
      <a href="/admin" className="back-link">返回總管理後台 →</a>
    </header>
    <div className="admin-main">
      <div className="admin-title"><div><p>ACCOUNTING QA TRIAL CONTROL</p><h1>QA 測試申請</h1><span>集中審核匿名 QA 測試額度申請，核准補發次數、拒絕申請或封鎖異常裝置。</span></div></div>
      <CentralAdminTabs active="qa" />
      {notice && <p className="medtech-admin-notice">{notice}</p>}
      <section className="qa-admin-panel">
        <header><div><small>APPLICATION QUEUE</small><h2>測試額度申請清單</h2></div><span>{rows.length} 筆申請</span></header>
        <div className="qa-admin-list">
          {rows.length ? rows.map(row => <article key={row.id} className={row.status}>
            <header><div><b>{row.displayName}</b><span>{row.email}</span></div><em>{row.status === "pending" ? "待審核" : row.status === "approved" ? "已核准" : row.status === "rejected" ? "已拒絕" : "已封鎖"}</em></header>
            <p>{row.reason}</p>
            <dl><div><dt>已用次數</dt><dd>{row.usedCount}／{10 + row.bonusCount}</dd></div><div><dt>申請時間</dt><dd>{new Date(row.requestedAt).toLocaleString("zh-TW")}</dd></div><div><dt>裝置識別</dt><dd>{row.deviceKey.slice(0, 10)}…</dd></div><div><dt>IP 雜湊</dt><dd>{row.ipHash.slice(0, 10)}…</dd></div></dl>
            {row.status === "pending" && <footer><label>補發<input type="number" min="1" max="100" value={grant[row.id] || 10} onChange={event => setGrant({ ...grant, [row.id]: Number(event.target.value) })}/>次</label><button onClick={() => void act(row.id, "approve")}>核准</button><button className="secondary" onClick={() => void act(row.id, "reject")}>拒絕</button><button className="danger" onClick={() => void act(row.id, "block")}>封鎖裝置</button><button className="danger" onClick={() => void act(row.id, "block_ip")}>封鎖此 IP</button></footer>}
            {row.deviceStatus !== "active" && <footer><button className="secondary" onClick={() => void act(row.id, "unblock")}>{row.deviceStatus === "blocked_ip" ? "解除此 IP 封鎖" : "解除裝置封鎖"}</button></footer>}
          </article>) : <div className="qa-admin-empty"><b>目前沒有 QA 測試申請</b><span>新的額度申請送出後，會集中顯示在這裡等待審核。</span></div>}
        </div>
      </section>
    </div>
  </main>;
}
