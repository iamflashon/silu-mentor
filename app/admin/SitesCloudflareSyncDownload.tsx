"use client";

import { useState } from "react";

export default function SitesCloudflareSyncDownload() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/cloudflare-sync-token", { method: "POST", cache: "no-store" });
      const data = await response.json() as { sitesUrl?: string; token?: string; expiresAt?: string; error?: string };
      if (!response.ok || !data.token) throw new Error(data.error || "無法建立同步設定");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `silu-mentor-sites-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      setNotice("同步設定已下載，有效 2 小時；接著執行本機批次即可自動補檔與索引。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "無法建立同步設定");
    } finally {
      setBusy(false);
    }
  }
  return <section className="sites-cloudflare-sync panel">
    <div><p>SITES → CLOUDFLARE R2</p><h2>缺檔同步</h2><span>下載一次性同步設定後，本機批次會找出 R2 缺檔、從 Sites 補回原稿，並自動接續精準索引；已存在的檔案會跳過。</span></div>
    <button type="button" className="primary-btn" onClick={() => void download()} disabled={busy}>{busy ? "準備中…" : "下載同步設定"}</button>
    {notice && <small role="status">{notice}</small>}
  </section>;
}
