"use client";

import { useEffect, useState } from "react";
import LinePayPurchaseButton from "./LinePayPurchaseButton";
import { useMedtechProductSettings } from "./useMedtechProductSettings";

const features = [
  "1,400+ 題臨床病毒學題庫",
  "章節刷題、跨章節模考及全真模擬",
  "每 30 題一個練習單元",
  "錯題自動整理與重練",
  "判斷提示及四個選項比較",
  "完整解題與康情老師語音解析",
];

export default function MedtechPlanDialog({ label = "查看方案內容", compact = false, price: suppliedPrice, accessDays: suppliedAccessDays, trialQuestions: suppliedTrialQuestions }: { label?: string; compact?: boolean; price?: number; accessDays?: number; trialQuestions?: number }) {
  const product = useMedtechProductSettings();
  const price = suppliedPrice ?? product?.effectivePrice ?? null;
  const accessDays = suppliedAccessDays ?? product?.accessDays ?? null;
  const trialQuestions = suppliedTrialQuestions ?? product?.trialQuestions ?? null;
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
            <p>{trialQuestions === null ? "方案讀取中…" : `首次可免費體驗 ${trialQuestions} 題；需要完整內容時，再一次付清開通本書。`}</p>
            <div className="medtech-plan-price"><strong>{price === null ? "讀取中…" : `NT$${price}`}</strong><span>{accessDays === null ? "讀取方案設定" : `完整使用 ${accessDays} 天`}<br />不限次練習・不自動續訂</span></div>
            <ul>{features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
            <div className="medtech-plan-note"><b>先體驗再決定</b><span>免費體驗與正式方案都會保存進度、錯題及學習紀錄。</span></div>
            <div className="medtech-plan-actions">
              {price === null ? <button type="button" disabled>讀取方案中…</button> : <LinePayPurchaseButton packageName="全庫通行證" packNumber={1} amount={price} label={`LINE Pay NT$${price} 開通本書`} />}
              <a href="/medtech/chapters" onClick={() => setOpen(false)}>{trialQuestions === null ? "免費體驗" : `先免費體驗 ${trialQuestions} 題`}</a>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
