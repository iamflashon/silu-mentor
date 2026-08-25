"use client";

import { useEffect, useState } from "react";
import { useMedtechProductSettings } from "./useMedtechProductSettings";

const features = [
  "1,400+ 題臨床病毒學題庫",
  "章節刷題、跨章節模考及全真模擬",
  "每 30 題一個練習單元",
  "錯題自動整理與重練",
  "判斷提示及四個選項比較",
  "完整解題與康情老師語音解析",
];

type SuppliedEntitlement = {
  purchased: true;
  startedAt: string;
  availableUntil: string;
};

export default function MedtechPlanDialog({
  label = "查看方案內容",
  compact = false,
  price: suppliedPrice,
  accessDays: suppliedAccessDays,
  trialQuestions: suppliedTrialQuestions,
  entitlement: suppliedEntitlement,
}: {
  label?: string;
  compact?: boolean;
  price?: number;
  accessDays?: number;
  trialQuestions?: number;
  entitlement?: SuppliedEntitlement | null;
}) {
  const product = useMedtechProductSettings();
  const price = suppliedPrice ?? product?.effectivePrice ?? null;
  const accessDays = suppliedAccessDays ?? product?.accessDays ?? null;
  const trialQuestions = suppliedTrialQuestions ?? product?.trialQuestions ?? null;
  // A server-rendered entitlement is authoritative. This avoids a second
  // browser-side auth check being misclassified in LINE's in-app browser.
  const entitlement = suppliedEntitlement ?? product?.entitlement ?? null;
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
            <p>{entitlement ? "你已購買本書數位題庫，通行證目前有效。" : trialQuestions === null ? "方案讀取中…" : `首次可免費體驗 ${trialQuestions} 題；需要完整內容時，再一次付清開通本書。`}</p>
            {entitlement ? (
              <div className="medtech-plan-price purchased"><strong>已購買</strong><span>開通：{new Date(entitlement.startedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}<br />有效至：{new Date(entitlement.availableUntil).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</span></div>
            ) : (
              <div className="medtech-plan-price"><strong>{price === null ? "讀取中…" : `NT$${price}`}</strong><span>{accessDays === null ? "讀取方案設定" : `完整使用 ${accessDays} 天`}<br />不限次練習・不自動續訂</span></div>
            )}
            <ul>{features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
            <div className="medtech-plan-note"><b>先體驗再決定</b><span>免費體驗與正式方案都會保存進度、錯題及學習紀錄。</span></div>
            <div className="medtech-plan-actions">
              {!entitlement && <a className="medtech-plan-purchase-link" href="/medtech/upgrade" onClick={() => setOpen(false)}>{price === null ? "查看開通方案" : `前往開通 NT$${price}`}</a>}
              <a href="/medtech/chapters" onClick={() => setOpen(false)}>{entitlement ? "進入已購買課程" : trialQuestions === null ? "免費體驗" : `先免費體驗 ${trialQuestions} 題`}</a>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
