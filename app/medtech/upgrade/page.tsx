"use client";

import { useEffect, useMemo, useState } from "react";
import MedtechTabs from "../MedtechTabs";

type Plan = {
  id: string;
  name: string;
  price: string;
  period: string;
  note: string;
  features: string[];
  recommended?: boolean;
};

const plans: Plan[] = [
  { id: "free", name: "免費版", price: "NT$0", period: "永久使用", note: "先熟悉題庫與基本作答", features: ["基本題目與作答", "基本錯題紀錄", "每日 2 題 AI 解析試用"] },
  { id: "credits", name: "AI 點數包", price: "NT$99", period: "一次購買／30 點", note: "適合只想補充 AI 互動的考生", features: ["AI 助教互動 30 點", "不改變題庫與試聽權益", "用完可再次購買"] },
  { id: "month", name: "月方案", price: "NT$249", period: "每月", note: "適合考前短期衝刺", features: ["完整逐選項解析", "AI 引導學習與筆記", "圖片、表格與醫學英文解析"] },
  { id: "exam", name: "185 天方案", price: "NT$1,288", period: "一次付費／185 天", note: "對應一次醫檢師考試週期", recommended: true, features: ["全部醫檢師題庫與模考", "錯題複習與學會移除", "完整 AI 解析與個人化進度"] },
  { id: "year", name: "年方案", price: "NT$1,490", period: "一次付費／365 天", note: "適合長期備考", features: ["185 天方案全部權益", "跨年度保存學習紀錄", "AI 點數用量與成本明細"] },
];

export default function MedtechUpgradePage() {
  const [selected, setSelected] = useState("exam");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "success" | "failed" | "cancelled" | "pending">("idle");
  const plan = useMemo(() => plans.find((item) => item.id === selected) ?? plans[2], [selected]);
  useEffect(() => { const value = new URLSearchParams(location.search).get("reason") || ""; setReason(value); if (value === "ai-credits") setSelected("credits"); }, []);

  return <main className="medtech-upgrade-page">
    <header className="medtech-top" data-no-navigation-feedback>
      <a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEMBERSHIP</small></div></a>
      <a className="medtech-member-link" href="/medtech/account">我的帳號</a>
    </header>
    <MedtechTabs active="random" />
    <section className="medtech-upgrade-head">
      <span>醫檢師會員方案</span>
      <h1>把需要的解析，放進你的備考計畫。</h1>
      <p>目前是測試付款頁：不會連接信用卡，也不會實際扣款。先確認方案、訂單與權限流程。</p>
    </section>
    <div className="medtech-test-banner"><b>{reason === "ai-credits" ? "AI 點數不足" : reason === "audio-trial" ? "免費試聽已用完" : "測試模式"}</b><span>{reason === "ai-credits" ? "你可以購買 AI 點數包，或改選完整會員方案。" : reason === "audio-trial" ? "前三題語音解析試聽已用完，訂閱後可繼續收聽。" : "以下按鈕只會模擬付款結果，不會產生真實訂單或扣款。"}</span></div>
    <section className="medtech-upgrade-grid" aria-label="醫檢師方案">
      <div className="medtech-plan-list">{plans.map((item) => <button type="button" key={item.id} className={`medtech-plan-card ${selected === item.id ? "selected" : ""}`} onClick={() => { setSelected(item.id); setState("idle"); }}>
        {item.recommended && <span className="recommended">建議</span>}
        <small>{item.name}</small><strong>{item.price}</strong><em>{item.period}</em><p>{item.note}</p>
        <ul>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      </button>)}</div>
      <aside className="medtech-order-card">
        <span>訂單確認</span><h2>{plan.name}</h2><p>{plan.note}</p>
        <dl><div><dt>方案費用</dt><dd>{plan.price}</dd></div><div><dt>有效期限</dt><dd>{plan.period}</dd></div><div><dt>自動續訂</dt><dd>目前未啟用</dd></div></dl>
        <button type="button" className="primary" onClick={() => setState("pending")}>進入測試付款</button>
        <small>正式上線前會改接金流業者通知；前端跳轉不會直接開通權限。</small>
        {state === "pending" && <div className="medtech-simulate"><b>模擬付款結果</b><p>請選擇一個結果測試會員權限流程。</p><div><button type="button" onClick={() => setState("success")}>成功</button><button type="button" onClick={() => setState("failed")}>失敗</button><button type="button" onClick={() => setState("cancelled")}>取消</button></div></div>}
        {state === "success" && <div className="medtech-payment-result success"><b>測試付款成功</b><span>示範：後端驗證通知後，才會開通 {plan.name}。</span></div>}
        {state === "failed" && <div className="medtech-payment-result failed"><b>測試付款失敗</b><span>示範：保留訂單，不開通方案，可重新付款。</span></div>}
        {state === "cancelled" && <div className="medtech-payment-result cancelled"><b>已取消測試付款</b><span>示範：回到方案頁，會員權限不變。</span></div>}
      </aside>
    </section>
    <p className="medtech-upgrade-foot">正式金流規劃：優先評估綠界一次付款；定期定額、電子發票與退款流程完成驗證後再開放。</p>
  </main>;
}
