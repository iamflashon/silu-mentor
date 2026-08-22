"use client";

import { useEffect, useState } from "react";
import LinePayPurchaseButton from "./LinePayPurchaseButton";

const features = [
  "1,400+ 題臨床病毒學題庫",
  "章節刷題、跨章節模考及全真模擬",
  "每 30 題一個練習單元",
  "錯題自動整理與重練",
  "判斷提示及四個選項比較",
  "完整解題與康情老師語音解析",
];

export default function MedtechPlanDialog({ label = "查看方案內容", compact = false }: { label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button className={compact ? "medtech-plan-trigger compact" : "medtech-plan-trigger"} type="button" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="medtech-plan-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="medtech-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-plan-title">
            <button className="medtech-plan-close" type="button" aria-label="關閉方案說明" onClick={() => setOpen(false)}>×</button>
            <span>本書數位題庫方案</span>
            <h2 id="medtech-plan-title">醫檢師國考題詳解（Ⅲ）<br />臨床病毒學（下）</h2>
            <p>首次可免費體驗 30 題；需要完整內容時，再一次付清開通本書。</p>
            <div className="medtech-plan-price"><strong>NT$199</strong><span>完整使用 30 天<br />不限次練習・不自動續訂</span></div>
            <ul>{features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
            <div className="medtech-plan-note"><b>先體驗再決定</b><span>免費體驗與正式方案都會保存進度、錯題及學習紀錄。</span></div>
            <div className="medtech-plan-actions">
              <LinePayPurchaseButton packageName="醫檢師國考題詳解（Ⅲ）臨床病毒學（下）" packNumber={1} amount={199} label="LINE Pay NT$199 開通本書" />
              <a href="/medtech/chapters" onClick={() => setOpen(false)}>先免費體驗 30 題</a>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
