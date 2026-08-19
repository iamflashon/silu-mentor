"use client";

import { useCallback, useEffect, useState } from "react";

type UsageResponse = { aiCredits?: number; points?: number };

export default function MedtechHeaderActions({ activePoints = false, accountLabel = "我的帳號" }: { activePoints?: boolean; accountLabel?: string }) {
  const [points, setPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshPoints = useCallback(async () => {
    try {
      const response = await fetch("/api/medtech/usage", { cache: "no-store" });
      if (!response.ok) {
        setPoints(null);
        return;
      }
      const data = await response.json() as UsageResponse;
      const nextPoints = typeof data.aiCredits === "number" ? data.aiCredits : data.points;
      setPoints(typeof nextPoints === "number" ? nextPoints : null);
    } catch {
      setPoints(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => { void refreshPoints(); };
    const initialRefresh = window.setTimeout(refresh, 0);
    window.addEventListener("medtech-points-updated", refresh);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 15000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("medtech-points-updated", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [refreshPoints]);

  return <div className="medtech-top-actions">
    <span className="medtech-points-balance" aria-live="polite" title="1 點＝NT$1；每次扣點後會自動更新">
      <small>可用點數</small>
      <b>{loading ? "…" : points ?? "—"}{points !== null && !loading ? <em> 點</em> : null}</b>
    </span>
    <a className={`medtech-points-link${activePoints ? " active" : ""}`} href="/medtech/pricing">點數說明</a>
    <a className="medtech-member-link" href="/medtech/account">{accountLabel}</a>
  </div>;
}
