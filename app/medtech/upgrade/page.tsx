"use client";

import { useEffect, useMemo, useState } from "react";
import MedtechTabs from "../MedtechTabs";

type PointOption = {
  id: string;
  name: string;
  amount: string;
  period: string;
  note: string;
  features: string[];
  purchasable: boolean;
  recommended?: boolean;
};

const pointOptions: PointOption[] = [
  { id: "welcome", name: "首次登入贈點", amount: "10 點", period: "登入後自動贈送", note: "先體驗題目、提示與引導學習流程", features: ["提示免費快取", "比較選項免費簡答", "語音完整解析每次扣 1 點"], purchasable: false },
  { id: "mock120", name: "全真模擬 120 題包", amount: "60 點", period: "一次購買／五折", note: "原本逐題需要 120 點，套票只扣 60 點", features: ["一組全真模擬試題全刷", "作答與錯題紀錄照常保存", "語音完整解析另扣 1 點"], purchasable: true, recommended: true },
  { id: "points", name: "一般點數", amount: "1 點起", period: "一次購買／無訂閱", note: "依照實際使用量扣點，不綁月費或年費", features: ["全真模擬看一題扣 1 點", "語音完整解析一次扣 1 點", "AI 追問一個問題扣 1 點"], purchasable: true },
];

export default function MedtechUpgradePage() {
  const [selected, setSelected] = useState("mock120");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "success" | "failed" | "cancelled" | "pending">("idle");
  const option = useMemo(() => pointOptions.find((item) => item.id === selected) ?? pointOptions[1], [selected]);

  useEffect(() => {
    const value = new URLSearchParams(location.search).get("reason") || "";
    setReason(value);
    if (value === "audio-trial" || value === "ai-credits" || value === "points") setSelected("points");
  }, []);

  const needsPoints = reason === "points" || reason === "ai-credits" || reason === "audio-trial";
  const bannerTitle = needsPoints ? "點數不足" : "點數制度";
  const bannerText = needsPoints ? "提示與比較選項不扣點；語音完整解析與 AI 追問依使用次數扣點，請選擇要取得的點數。" : "以下按鈕只會模擬點數購買，不會產生真實訂單或扣款。";

  return <main className="medtech-upgrade-page">
    <header className="medtech-top" data-no-navigation-feedback>
      <a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>POINTS</small></div></a>
      <a className="medtech-member-link" href="/medtech/account">我的帳號</a>
    </header>
    <MedtechTabs active="random" />
    <section className="medtech-upgrade-head">
      <span>醫檢師點數商店</span>
      <h1>不用訂閱，按照使用方式簡單扣點。</h1>
      <p>學員首次登入贈送 10 點；全真模擬、康情老師語音完整解析與 AI 追問，各自依使用量扣點。</p>
    </section>
    <div className="medtech-test-banner"><b>{bannerTitle}</b><span>{bannerText}</span></div>
    <section className="medtech-upgrade-grid" aria-label="醫檢師點數方案">
      <div className="medtech-plan-list">{pointOptions.map((item) => <button type="button" key={item.id} className={`medtech-plan-card ${selected === item.id ? "selected" : ""}`} onClick={() => { setSelected(item.id); setState("idle"); }}>
        {item.recommended && <span className="recommended">最划算</span>}
        {!item.purchasable && <span className="recommended">登入即送</span>}
        <small>{item.name}</small><strong>{item.amount}</strong><em>{item.period}</em><p>{item.note}</p>
        <ul>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      </button>)}</div>
      <aside className="medtech-order-card">
        <span>點數明細</span><h2>{option.name}</h2><p>{option.note}</p>
        <dl><div><dt>取得點數</dt><dd>{option.amount}</dd></div><div><dt>使用方式</dt><dd>依功能扣點</dd></div><div><dt>自動續訂</dt><dd>不適用</dd></div></dl>
        <button type="button" className="primary" disabled={!option.purchasable} onClick={() => setState("pending")}>{option.purchasable ? "進入點數購買測試" : "首次登入自動贈送"}</button>
        <small>正式上線後採一次付款取得點數；實際 NT$ 售價由後台點數商品設定。</small>
        {state === "pending" && <div className="medtech-simulate"><b>模擬購買結果</b><p>請選擇一個結果測試點數入帳流程。</p><div><button type="button" onClick={() => setState("success")}>成功</button><button type="button" onClick={() => setState("failed")}>失敗</button><button type="button" onClick={() => setState("cancelled")}>取消</button></div></div>}
        {state === "success" && <div className="medtech-payment-result success"><b>測試購買成功</b><span>示範：後端驗證付款通知後，才會把 {option.amount} 寫入帳號。</span></div>}
        {state === "failed" && <div className="medtech-payment-result failed"><b>測試購買失敗</b><span>示範：保留訂單，不入帳，可重新購買。</span></div>}
        {state === "cancelled" && <div className="medtech-payment-result cancelled"><b>已取消測試購買</b><span>示範：回到點數商店，帳號點數不變。</span></div>}
      </aside>
    </section>
    <p className="medtech-upgrade-foot">點數規則：提示與比較選項免費；全真模擬看一題 1 點；語音完整解析一次 1 點；AI 追問一題 1 點。管理員加點與所有扣點都會留下紀錄。</p>
  </main>;
}
