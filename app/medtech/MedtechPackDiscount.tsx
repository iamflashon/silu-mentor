"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Props = { packageName: string; packNumber: number; questionTotal: number; label: string; href: string };
type Reward = {
  status?: "available" | "revealed" | "abandoned" | "used";
  label?: string | null;
  cost?: number;
  percent?: number | null;
  retryAt?: string | null;
};

const wheelAngles: Record<string, number> = { "五折": 0, "七五折": 90, "九折": 180, "原價": 270 };

function remainingRetryText(retryAt: string | null | undefined, now: number) {
  if (!retryAt) return "";
  const minutes = Math.max(0, Math.ceil((new Date(retryAt).getTime() - now) / 60000));
  if (!minutes) return "現在可以再抽一次";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `約 ${hours} 小時後可再抽` : `約 ${minutes} 分鐘後可再抽`;
}

export default function MedtechPackDiscount({ packageName, packNumber, questionTotal, label, href }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [used, setUsed] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    void fetch(`/api/medtech/question-pack-reward?packageName=${encodeURIComponent(packageName)}&pack=${packNumber}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { reward?: Reward };
      })
      .then((result) => {
        if (!mounted) return;
        setLoaded(true);
        const next = result?.reward;
        if (next?.status === "used") setUsed(true);
        if (next && next.status !== "available" && next.status !== "used") setReward(next);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => { mounted = false; };
  }, [packageName, packNumber]);

  const retryAtMs = reward?.retryAt ? new Date(reward.retryAt).getTime() : 0;
  useEffect(() => {
    if (!retryAtMs) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAtMs) {
        setReward(null);
        setOpen(false);
      }
    };
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, [retryAtMs]);

  function openWheel() {
    setError("");
    setOpen(true);
  }

  function closeWheel() {
    if (!busy) setOpen(false);
  }

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
      const nextReward = result.reward;
      if (nextReward.status !== "revealed") {
        setReward(nextReward);
        setBusy(false);
        return;
      }
      const target = wheelAngles[nextReward.label || "原價"] ?? 270;
      setWheelRotation((current) => current + 1440 + target);
      setSpinning(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1750));
      setReward(nextReward);
      setSpinning(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "轉轉樂暫時無法使用，請稍後再試。");
    }
    setBusy(false);
  }

  const retryText = remainingRetryText(reward?.retryAt, now);
  const isOriginal = reward?.label === "原價";

  return <>
    <div className={`medtech-pack-discount-card${isOriginal ? " is-original" : ""}`}>
      <div className="medtech-pack-discount-topline"><span>第 {packNumber} 關</span><i aria-hidden="true">🎡</i></div>
      <b>{questionTotal} 題</b>
      <small>{label}</small>
      {!loaded ? <span className="medtech-discount-loading"><span className="medtech-loading-spinner" /> 轉轉樂讀取中…</span> : used ? <div className="medtech-discount-revealed"><strong>本關已使用過優惠</strong><a href={href}>30 點重新解鎖 →</a></div> : reward ? <div className="medtech-discount-revealed">
        <strong>{isOriginal ? "這次抽到原價" : `🎉 抽到${reward.label || "優惠"}`}｜{reward.cost ?? 30} 點</strong>
        {isOriginal && retryText && <em>{retryText}</em>}
        <a href={href}>前往解鎖 →</a>
      </div> : <button type="button" onClick={openWheel} disabled={busy} aria-busy={busy}>🎡 打開轉轉樂</button>}
      {error && <em>{error}</em>}
    </div>
    {open && <div className="medtech-spin-backdrop" role="presentation" onMouseDown={closeWheel}>
      <section className="medtech-spin-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-spin-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="medtech-spin-close" onClick={closeWheel} disabled={busy} aria-label="關閉">×</button>
        <span className="medtech-spin-kicker">LIMITED-TIME SPIN</span>
        <h2 id="medtech-spin-title">🎡 轉轉樂</h2>
        <p>抽到優惠就用優惠價解鎖；如果抽到原價，24 小時後可以再來試一次。</p>
        <div className="medtech-spin-stage" aria-live="polite">
          <span className="medtech-spin-spark spark-one" aria-hidden="true">✦</span>
          <span className="medtech-spin-spark spark-two" aria-hidden="true">✧</span>
          <span className="medtech-spin-pointer" aria-hidden="true">▼</span>
          <div className={`medtech-spin-wheel${spinning ? " is-spinning" : ""}`} style={{ "--medtech-wheel-rotation": `${wheelRotation}deg` } as CSSProperties}>
            <span className="wheel-label wheel-five">五折</span>
            <span className="wheel-label wheel-seventy-five">七五折</span>
            <span className="wheel-label wheel-ninety">九折</span>
            <span className="wheel-label wheel-original">原價</span>
            <span className="medtech-spin-wheel-center">✦</span>
          </div>
        </div>
        {!reward ? <button type="button" className="medtech-spin-start" onClick={() => void spin()} disabled={busy} aria-busy={busy}>{busy ? <><span className="medtech-loading-spinner" /> 抽獎中…</> : "開始抽獎"}</button> : <div className={`medtech-spin-result${isOriginal ? " original" : ""}`}>
          <strong>{isOriginal ? "這次是原價" : `恭喜你抽到${reward.label}`}</strong>
          <span>{isOriginal ? `${retryText || "24 小時後可再抽一次"}；現在也能用 ${reward.cost ?? 30} 點解鎖。` : `本關只要 ${reward.cost ?? 30} 點即可解鎖。`}</span>
          <a href={href}>前往解鎖 →</a>
        </div>}
        {error && <em className="medtech-spin-error">{error}</em>}
      </section>
    </div>}
  </>;
}
