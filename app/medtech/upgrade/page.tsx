"use client";

import { useEffect, useMemo, useState } from "react";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";

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
  { id: "welcome", name: "首次登入贈點", amount: "10 點＝NT$10", period: "登入後自動贈送", note: "先體驗題目、提示與引導學習流程", features: ["提示免費快取", "比較選項免費簡答", "語音完整解析每次扣 1 點／NT$1"], purchasable: false },
  { id: "mock120", name: "全真模擬 120 題包", amount: "60 點＝NT$60", period: "一次購買／五折", note: "一次取得完整 120 題；題目包開通後 7 天內不限次數重做", features: ["120 題一次購足", "完整保存刷題統計與錯題分析", "語音完整解析另扣 1 點／NT$1／24 小時"], purchasable: true, recommended: true },
  { id: "points", name: "章節／隨機題目包", amount: "30 點＝NT$30／包", period: "30 題／7 天", note: "任選一包免費體驗一次；完成前一關後，每包最多 2 次答題挑戰，每題 5 秒，另有一次轉轉樂，最高五折", features: ["任選一包 30 題免費", "答題挑戰最多 2 次＋轉轉樂 1 次", "語音解析 1 點／NT$1／24 小時；AI 追問 1 點／NT$1／題"], purchasable: true },
];

export default function MedtechUpgradePage() {
  const [selected, setSelected] = useState("mock120");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "success" | "failed" | "cancelled" | "pending">("idle");
  const option = useMemo(() => pointOptions.find((item) => item.id === selected) ?? pointOptions[1], [selected]);

  useEffect(() => {
    const value = new URLSearchParams(location.search).get("reason") || "";
    setReason(value);
    if (value === "audio-trial" || value === "ai-credits" || value === "points" || value === "question-pack") setSelected("points");
  }, []);

  const needsPoints = reason === "points" || reason === "ai-credits" || reason === "audio-trial";
  const bannerTitle = needsPoints ? "點數不足" : "點數制度";
  const bannerText = reason === "question-pack" ? "目前這一包可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，另可抽一次轉轉樂，最高五折；完成後再用點數解鎖，開通後 7 天內不限次數重做。" : needsPoints ? "提示與比較選項不扣點；題目包每包最多 2 次答題挑戰與 1 次轉轉樂，語音解析 24 小時內可重聽，AI 追問依新問題扣點。" : "以下按鈕只會模擬點數購買，不會產生真實訂單或扣款。";

  return <main className="medtech-upgrade-page">
    <header className="medtech-top" data-no-navigation-feedback>
      <a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>POINTS</small></div></a>
      <MedtechHeaderActions activePoints />
    </header>
    <MedtechTabs />
    <section className="medtech-upgrade-head">
      <span>醫檢師點數商店</span>
      <h1>不用訂閱，1 點就是 NT$1，按照使用方式簡單扣點。</h1>
      <p>學員首次登入贈送 10 點；任選一包 30 題免費初體驗，完成前一關後可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，另可抽一次限時轉轉樂，最高五折；之後再用點數解鎖，7 天內不限次數重做。</p>
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
        <small>點數不兌現、不轉讓；購買時以 1 點＝NT$1 計算。</small>
        {state === "pending" && <div className="medtech-simulate"><b>模擬購買結果</b><p>請選擇一個結果測試點數入帳流程。</p><div><button type="button" onClick={() => setState("success")}>成功</button><button type="button" onClick={() => setState("failed")}>失敗</button><button type="button" onClick={() => setState("cancelled")}>取消</button></div></div>}
        {state === "success" && <div className="medtech-payment-result success"><b>測試購買成功</b><span>示範：後端驗證付款通知後，才會把 {option.amount} 寫入帳號。</span></div>}
        {state === "failed" && <div className="medtech-payment-result failed"><b>測試購買失敗</b><span>示範：保留訂單，不入帳，可重新購買。</span></div>}
        {state === "cancelled" && <div className="medtech-payment-result cancelled"><b>已取消測試購買</b><span>示範：回到點數商店，帳號點數不變。</span></div>}
      </aside>
    </section>
    <p className="medtech-upgrade-foot">點數規則：提示與比較選項免費；題目包每關 30 題／7 天不限次數，完成前一關後每包最多 2 次答題挑戰，每題 5 秒，另有一次限時轉轉樂，最高五折；語音完整解析 1 點／24 小時；AI 追問一個新問題 1 點。所有刷題分析、贈點、加點、抽獎與扣點都會留下紀錄。</p>
  </main>;
}
