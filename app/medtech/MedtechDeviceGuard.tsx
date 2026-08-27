"use client";

import { useEffect, useState } from "react";

type Session = { id: number; deviceLabel: string; firstSeenAt: string | number | Date; lastSeenAt: string | number | Date };
type Status = { blocked: boolean; maxDevices: number; sessions: Session[]; anomaly?: { flagged: boolean; reason: string }; reloginNotice?: { lastLoginAt: string | number | Date } | null; resume?: { description: string; availableUntil: string | number | Date | null } | null };

function taipeiTime(value: string | number | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "時間未知" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short", hour12: false, timeZone: "Asia/Taipei" }).format(date);
}

function remainingText(value: string | number | Date | null) {
  if (!value) return "沒有可用的題目包期限資料";
  const minutes = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 60000));
  if (!minutes) return "已到期，重新解鎖即可繼續";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `剩餘 ${days} 天 ${hours} 小時${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
}

export default function MedtechDeviceGuard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [reloginDismissed, setReloginDismissed] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/medtech/session", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as Status;
      setStatus(data);
    } catch { /* 登入狀態尚未就緒時不打擾頁面 */ }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(timer);
  }, []);

  async function kick(sessionId: number) {
    if (busyId) return;
    setBusyId(sessionId);
    setMessage("");
    try {
      const response = await fetch("/api/medtech/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "kick", sessionId }) });
      const data = await response.json() as Status & { error?: string };
      if (!response.ok) setMessage(data.error || "目前無法登出該裝置，請重新整理。");
      else {
        setStatus(data);
        window.setTimeout(() => window.location.reload(), 350);
      }
    } catch { setMessage("網路連線暫時中斷，請再試一次。"); }
    finally { setBusyId(null); }
  }

  const showRelogin = Boolean(status?.reloginNotice && !reloginDismissed);
  if (!status || (!status.blocked && !showRelogin)) return null;
  if (!status.blocked && showRelogin) return <div className="medtech-device-lock-backdrop" role="presentation"><section className="medtech-device-lock-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-relogin-title">
    <span className="medtech-device-lock-kicker">歡迎回到醫檢師備考</span>
    <h2 id="medtech-relogin-title">你的學習進度已接續</h2>
    <p>這台裝置已超過 {7} 天沒有使用，登入狀態已自動失效；本次重新登入後，系統會重新保護你的裝置名額。</p>
    <div className="medtech-relogin-summary"><div><small>上次登入</small><b>{taipeiTime(status.reloginNotice?.lastLoginAt ?? Date.now())}</b></div><div><small>最後學習包</small><b>{status.resume?.description ?? "尚無題目包紀錄"}</b><span>{status.resume ? remainingText(status.resume.availableUntil) : "開始任選一包免費題目"}</span></div></div>
    <button type="button" className="medtech-relogin-continue" onClick={() => setReloginDismissed(true)}>開始學習</button>
  </section></div>;
  return <div className="medtech-device-lock-backdrop" role="presentation"><section className="medtech-device-lock-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-device-lock-title">
    <span className="medtech-device-lock-kicker">帳號使用提醒</span>
    <h2 id="medtech-device-lock-title">此帳號已在 {status.maxDevices} 台裝置使用</h2>
    <p>為保障您的帳號與付費內容，單一帳號最多同時登入 {status.maxDevices} 台裝置。請選擇一台登出，再在本機繼續學習。</p>
    {status.anomaly?.flagged && <div className="medtech-device-lock-alert">系統已記錄一筆異常登入風險提示：{status.anomaly.reason}。若不是本人操作，請聯絡管理員。</div>}
    <div className="medtech-device-lock-list">{status.sessions.map((session) => <article key={session.id}><div><b>{session.deviceLabel}</b><small>最近使用：{taipeiTime(session.lastSeenAt)}</small></div><button type="button" onClick={() => void kick(session.id)} disabled={busyId !== null}>{busyId === session.id ? "登出中…" : "登出這台"}</button></article>)}</div>
    {message && <p className="medtech-device-lock-message">{message}</p>}
    <small className="medtech-device-lock-note">若你使用的是換網路、VPN 或手機行動網路，系統可能將它視為不同網路來源；需要協助時請聯繫管理員。</small>
  </section></div>;
}
