"use client";

import { useState } from "react";

type Props = { packageName: string; packNumber: number; questionTotal: number; label: string; href: string };
type Reward = { label?: string | null; cost?: number };

export default function MedtechPackDiscount({ packageName, packNumber, questionTotal, label, href }: Props) {
  const [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [error, setError] = useState("");

  async function spin() {
    if (busy || reward) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName, pack: packNumber, action: "spin" }),
      });
      const result = await response.json() as { reward?: Reward; error?: string };
      if (!response.ok || !result.reward) throw new Error(result.error || "轉轉樂暫時無法使用，請稍後再試。");
      setReward(result.reward);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "轉轉樂暫時無法使用，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return <div className="medtech-pack-discount-card">
    <span>第 {packNumber} 關</span>
    <b>{questionTotal} 題</b>
    <small>{label}</small>
    {reward ? <><strong>🎉 抽到{reward.label || "優惠"}｜{reward.cost ?? 30} 點</strong><a href={href}>前往解鎖 →</a></> : <button type="button" onClick={() => void spin()} disabled={busy} aria-busy={busy}>{busy ? "抽取中…" : "🎡 抽一次折扣 →"}</button>}
    {error && <em>{error}</em>}
  </div>;
}
