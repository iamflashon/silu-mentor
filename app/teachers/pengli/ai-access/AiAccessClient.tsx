"use client";

import { FormEvent, useEffect, useState } from "react";

type AccessState = {
  plan?: { enabled: boolean; name: string; price: number; quota: number; durationDays: number; coachRounds: number };
  aiAccess?: { active: boolean; remaining: number; quotaTotal: number; quotaUsed: number; coachRoundsUsed: number; coachRoundsTarget: number; expiresAt: string | null };
  error?: string;
};

export default function AiAccessClient() {
  const [data, setData] = useState<AccessState | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/ai-access", { cache: "no-store" });
    const result = await response.json() as AccessState;
    if (response.ok) setData(result); else setNotice(result.error || "請先登入會員帳號。");
  }

  useEffect(() => { void load(); }, []);

  async function redeem(event: FormEvent) {
    event.preventDefault(); if (!code.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/ai-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const result = await response.json() as AccessState & { ok?: boolean };
      if (!response.ok) throw new Error(result.error || "兌換失敗");
      setCode(""); setData(result); setNotice("AI 次數已成功加入帳號，可以返回彭狸教練開始陪練。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "兌換失敗"); }
    finally { setBusy(false); }
  }

  async function purchase() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/ai-access/line-pay/request", { method: "POST" });
      const result = await response.json() as { paymentUrl?: string; error?: string };
      if (!response.ok || !result.paymentUrl) throw new Error(result.error || "目前無法建立付款");
      window.location.href = result.paymentUrl;
    } catch (error) { setNotice(error instanceof Error ? error.message : "目前無法建立付款"); setBusy(false); }
  }

  const plan = data?.plan;
  const access = data?.aiAccess;
  return <div className="pengli-ai-access-grid">
    <section className="pengli-ai-plan-card">
      <span>AI PRACTICE PASS</span><h1>彭狸 AI 陪練次數</h1>
      <p>老師引導與 AI 學霸追問合計為一輪；完成 {plan?.coachRounds ?? 5} 輪才扣 1 次。</p>
      <div className="pengli-ai-balance"><small>目前剩餘</small><strong>{access?.active ? access.remaining : 0}<em> 次</em></strong><span>{access?.active && access.expiresAt ? `可使用至 ${new Date(access.expiresAt).toLocaleDateString("zh-TW")}` : "目前沒有有效方案"}</span></div>
      <ul><li>彭狸教材逐頁檢索與頁碼引用</li><li>彭狸 AI 教練分段引導</li><li>AI 學霸反面與例外追問</li><li>每 5 輪才扣 1 次</li></ul>
    </section>
    <section className="pengli-ai-purchase-card">
      <span>購買 AI 次數</span><h2>{plan?.name || "AI 學習方案"}</h2>
      <div className="pengli-ai-price"><strong>NT$ {plan?.price ?? 30}</strong><small>{plan?.quota ?? 30} 次・{plan?.durationDays ?? 30} 天</small></div>
      <button type="button" onClick={() => void purchase()} disabled={busy || !plan?.enabled || Boolean(access?.active)}>{access?.active ? "目前方案使用中" : plan?.enabled ? "使用 LINE Pay 購買" : "方案尚未開放"}</button>
      <small>付款完成後會自動加入目前登入帳號，不會自動續約。</small>
      <hr />
      <form onSubmit={redeem}><label>輸入 AI 次數兌換碼<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="IB-AI-XXXX-XXXX" autoComplete="off" /></label><button type="submit" disabled={busy || !code.trim()}>兌換到我的帳號</button></form>
      {notice && <p role="status">{notice}</p>}
      <a href="/teachers/pengli/coach">← 返回彭狸 AI 教練</a>
    </section>
  </div>;
}
