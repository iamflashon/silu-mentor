"use client";

import { useState } from "react";

export default function DeleteMemberAccountButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
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
        body: JSON.stringify({ confirmation, email }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "帳號刪除失敗，請稍後再試。");
      window.location.replace(`/member-register?return_to=${encodeURIComponent("/medtech")}&deleted=1&t=${Date.now()}`);
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
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>刪除我的帳號與學習資料</button>
      ) : (
        <div className="medtech-account-delete-confirm">
          <label>
            請輸入「刪除我的帳號」確認
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          {error && <small>{error}</small>}
          <div>
            <button type="button" onClick={() => { setOpen(false); setConfirmation(""); setError(""); }}>取消</button>
            <button type="button" className="danger" disabled={confirmation !== "刪除我的帳號" || busy} onClick={() => void removeAccount()}>{busy ? "刪除中…" : "永久刪除"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
