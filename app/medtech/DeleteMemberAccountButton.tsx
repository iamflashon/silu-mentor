"use client";

import { useState } from "react";

export default function DeleteMemberAccountButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function removeAccount() {
    if (confirmation !== "刪除我的帳號" || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/member/account", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, email, password }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; deletionRef?: string };
      if (!response.ok) throw new Error(result.error || "帳號刪除失敗，請稍後再試。");
      setReceipt(result.deletionRef ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "帳號刪除失敗，請稍後再試。");
      setBusy(false);
    }
  }

  return (
    <section className="medtech-account-delete-zone">
      <div>
        <h2>刪除會員帳號</h2>
        <p>刪除後，免費體驗、作答、錯題、筆記與本書開通狀態都會歸零；同一 Email 可重新註冊。已付款交易僅保留去識別化帳務紀錄。</p>
      </div>
      {receipt ? <div className="medtech-account-delete-confirm"><strong>帳號與學習資料已刪除</strong><p>刪除證明編號：<b>{receipt}</b></p><p>請保存此編號；管理員僅保留去識別化稽核與付款紀錄。</p><a href="/member-register?return_to=%2Fmedtech">使用同一 Email 重新註冊</a></div> : !open ? (
        <button type="button" onClick={() => setOpen(true)}>刪除我的帳號與學習資料</button>
      ) : (
        <div className="medtech-account-delete-confirm">
          <label>
            請再次輸入目前密碼
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <label>
            請輸入「刪除我的帳號」確認
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          {error && <small>{error}</small>}
          <div>
            <button type="button" onClick={() => { setOpen(false); setConfirmation(""); setPassword(""); setError(""); }}>取消</button>
            <button type="button" className="danger" disabled={confirmation !== "刪除我的帳號" || !password || busy} onClick={() => void removeAccount()}>{busy ? "刪除中…" : "永久刪除"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
