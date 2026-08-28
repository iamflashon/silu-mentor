"use client";

import { FormEvent, useEffect, useState } from "react";

type AccessState = {
  plan?: { enabled: boolean; name: string; price: number; quota: number; standardQuota: number; bonusQuota: number; promoActive: boolean; promoEndsAt: string; durationDays: number };
  aiAccess?: { active: boolean; remaining: number; quotaTotal: number; quotaUsed: number; expiresAt: string | null };
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

  useEffect(() => {
    const payment = new URLSearchParams(window.location.search).get("ai_payment");
    if (payment === "success") setNotice("LINE Pay 付款完成，已將 AI 次數與使用期限加入帳號。");
    else if (payment === "cancelled") setNotice("你已取消 LINE Pay 付款，本次不會扣款或增加次數。");
    else if (payment === "missing" || payment === "invalid") setNotice("找不到可確認的付款訂單，請勿重複付款並聯絡管理員查核。");
    else if (payment) setNotice("LINE Pay 尚未完成付款，未扣款也未增加次數。");
    void load();
  }, []);

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
      const response = await fetch("/api/ai-access/line-pay/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purchaseContext: "pengli" }) });
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
      <p>所有功能都使用同一種 AI 次數：一般 AI 成功回答扣 1 次；查證官方資料成功扣 2 次。</p>
      <div className="pengli-ai-balance"><small>目前剩餘</small><strong>{access?.active ? access.remaining : 0}<em> 次</em></strong><span>{access?.active && access.expiresAt ? `可使用至 ${new Date(access.expiresAt).toLocaleDateString("zh-TW")}` : "目前沒有有效方案"}</span></div>
      <ul><li>一般對話、針對這段追問：成功扣 1 次</li><li>白話解釋、學霸代答：成功扣 1 次</li><li>官方資料查證：成功且附官方網址才扣 2 次</li><li>失敗、逾時或查無精準資料：不扣次</li></ul>
    </section>
    <section className="pengli-ai-purchase-card">
      <span>{plan?.promoActive ? "限時首購優惠" : "購買 AI 次數"}</span><h2>{plan?.promoActive ? `NT$${plan.price}｜${plan.standardQuota} 次再送 ${plan.bonusQuota} 次` : plan?.name || "AI 使用方案"}</h2>
      <div className="pengli-ai-price"><strong>NT$ {plan?.price ?? 30}</strong><small>{plan?.quota ?? 30} 次・{plan?.durationDays ?? 30} 天</small></div>
      {plan?.promoActive && <p className="pengli-ai-promo">本次共 {plan.quota} 次；每位會員限首購一次，優惠至 {new Date(plan.promoEndsAt).toLocaleDateString("zh-TW")}。</p>}
      <button type="button" onClick={() => void purchase()} disabled={busy}>{busy ? "正在前往 LINE Pay…" : access?.active ? `LINE Pay NT${plan?.price ?? 30} 加購 ${plan?.quota ?? 30} 次` : `LINE Pay NT${plan?.price ?? 30} 購買`}</button>
      <small>{access?.active ? `加購會保留目前剩餘次數，另加 ${plan?.quota ?? 30} 次，並由目前到期日再延長 ${plan?.durationDays ?? 30} 天。` : "付款完成後會自動加入目前登入帳號，不會自動續約。"}</small>
      <hr />
      <form onSubmit={redeem}><label>輸入 AI 次數兌換碼<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="IB-AI-XXXX-XXXX" autoComplete="off" /></label><button type="submit" disabled={busy || !code.trim()}>兌換到我的帳號</button></form>
      {notice && <p role="status">{notice}</p>}
      <a href="/teachers/pengli/coach">← 返回彭狸 AI 教練</a>
    </section>
  </div>;
}
