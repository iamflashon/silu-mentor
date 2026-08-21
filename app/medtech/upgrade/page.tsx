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
  {
    id: "mock120",
    name: "全真模擬 120 題包",
    amount: "NT$60",
    period: "一次購買／7 天",
    note: "一次取得完整 120 題；購買後 7 天內不限次數重做",
    features: [
      "120 題一次購足",
      "完整保存刷題統計與錯題分析",
      "已整理解析與老師語音皆包含",
    ],
    purchasable: true,
    recommended: true,
  },
  {
    id: "points",
    name: "章節／隨機題目包",
    amount: "NT$30／包",
    period: "30 題／7 天",
    note: "任選一包免費體驗一次；完成前一關後，每包最多 2 次答題挑戰，每題 5 秒，另有一次轉轉樂，最高五折",
    features: [
      "任選一包 30 題免費",
      "答題挑戰最多 2 次＋轉轉樂 1 次",
      "解題提示、選項比較、完整解析與老師語音皆包含",
    ],
    purchasable: true,
  },
];

export default function MedtechUpgradePage() {
  const [selected, setSelected] = useState("mock120");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<
    "idle" | "success" | "failed" | "cancelled" | "pending"
  >("idle");
  const option = useMemo(
    () => pointOptions.find((item) => item.id === selected) ?? pointOptions[1],
    [selected],
  );

  useEffect(() => {
    const value = new URLSearchParams(location.search).get("reason") || "";
    setReason(value);
    if (
      value === "audio-trial" ||
      value === "ai-credits" ||
      value === "points" ||
      value === "question-pack"
    )
      setSelected("points");
  }, []);

  const needsPoints =
    reason === "points" || reason === "ai-credits" || reason === "audio-trial";
  const bannerTitle = "題目包直接購買";
  const bannerText =
    reason === "question-pack"
      ? "目前這一包可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，另可抽一次轉轉樂，最高五折；購買後 7 天內不限次數重做。"
      : needsPoints
        ? "平台已停止販售點數；解題提示、選項比較、完整解析與老師語音改為隨題目包提供。"
        : "以下按鈕目前只模擬題目包訂單，不會產生真實扣款。";

  return (
    <main className="medtech-upgrade-page">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>PACKAGES</small>
          </div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs />
      <section className="medtech-upgrade-head">
        <span>醫檢師題目包</span>
        <h1>不用訂閱，題目包直接以新台幣購買。</h1>
        <p>
          任選一包 30
          題免費初體驗；其他題目包直接以新台幣購買，內含解題提示、選項比較、完整解析與老師語音，購買後
          7 天內不限次數重做。
        </p>
      </section>
      <div className="medtech-test-banner">
        <b>{bannerTitle}</b>
        <span>{bannerText}</span>
      </div>
      <section className="medtech-upgrade-grid" aria-label="醫檢師題目包方案">
        <div className="medtech-plan-list">
          {pointOptions.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`medtech-plan-card ${selected === item.id ? "selected" : ""}`}
              onClick={() => {
                setSelected(item.id);
                setState("idle");
              }}
            >
              {item.recommended && <span className="recommended">最划算</span>}
              {!item.purchasable && (
                <span className="recommended">登入即送</span>
              )}
              <small>{item.name}</small>
              <strong>{item.amount}</strong>
              <em>{item.period}</em>
              <p>{item.note}</p>
              <ul>
                {item.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <aside className="medtech-order-card">
          <span>訂單明細</span>
          <h2>{option.name}</h2>
          <p>{option.note}</p>
          <dl>
            <div>
              <dt>售價</dt>
              <dd>{option.amount}</dd>
            </div>
            <div>
              <dt>使用內容</dt>
              <dd>題目包內全部內容</dd>
            </div>
            <div>
              <dt>自動續訂</dt>
              <dd>不適用</dd>
            </div>
          </dl>
          <button
            type="button"
            className="primary"
            disabled={!option.purchasable}
            onClick={() => setState("pending")}
          >
            進入題目包購買測試
          </button>
          <small>不儲值點數；每次直接購買指定題目包。</small>
          {state === "pending" && (
            <div className="medtech-simulate">
              <b>模擬購買結果</b>
              <p>請選擇一個結果測試題目包開通流程。</p>
              <div>
                <button type="button" onClick={() => setState("success")}>
                  成功
                </button>
                <button type="button" onClick={() => setState("failed")}>
                  失敗
                </button>
                <button type="button" onClick={() => setState("cancelled")}>
                  取消
                </button>
              </div>
            </div>
          )}
          {state === "success" && (
            <div className="medtech-payment-result success">
              <b>測試購買成功</b>
              <span>示範：後端驗證付款通知後，才會開通 {option.name}。</span>
            </div>
          )}
          {state === "failed" && (
            <div className="medtech-payment-result failed">
              <b>測試購買失敗</b>
              <span>示範：保留訂單，不入帳，可重新購買。</span>
            </div>
          )}
          {state === "cancelled" && (
            <div className="medtech-payment-result cancelled">
              <b>已取消測試購買</b>
              <span>示範：回到題目包頁面，不開通內容。</span>
            </div>
          )}
        </aside>
      </section>
      <p className="medtech-upgrade-foot">
        題目包每關 30 題，購買後 7
        天內不限次數重做；解題提示、選項比較、完整解析與老師語音皆包含。即時 AI
        追問目前暫停開放，不販售點數或追問次數。
      </p>
    </main>
  );
}
