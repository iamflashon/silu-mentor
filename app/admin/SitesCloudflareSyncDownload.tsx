"use client";

import { ChangeEvent, useState } from "react";

type SyncConfig = { sitesUrl: string; token: string; expiresAt?: string };
type MissingDocument = { id: number; fileName: string; storageKey: string };

export default function SitesCloudflareSyncDownload() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [progress, setProgress] = useState<string[]>([]);

  async function api(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/cloudflare-r2-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(data.error || "同步失敗"));
    return data;
  }

  async function download() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/cloudflare-sync-token", { method: "POST", cache: "no-store" });
      const data = await response.json() as SyncConfig & { error?: string };
      if (!response.ok || !data.token) throw new Error(data.error || "無法建立同步設定");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob);
      anchor.download = `silu-mentor-sites-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`; anchor.click(); URL.revokeObjectURL(anchor.href);
      setNotice("同步設定已下載，有效 2 小時；請到 Cloudflare 後台的同一區塊匯入並執行。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "無法建立同步設定"); }
    finally { setBusy(false); }
  }

  async function importConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as SyncConfig;
      if (!parsed.sitesUrl || !parsed.token) throw new Error("同步設定格式不正確");
      setConfig(parsed); setNotice(`已匯入 Sites 同步設定${parsed.expiresAt ? `（有效至 ${new Date(parsed.expiresAt).toLocaleString("zh-TW")}）` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "無法讀取同步設定"); }
  }

  async function run() {
    if (busy || !config) return;
    setBusy(true); setProgress([]); setNotice("正在檢查 Cloudflare D1 與 R2…");
    try {
      const scan = await api({ action: "scan" }) as { total?: number; existing?: number; missing?: MissingDocument[] };
      const missing = scan.missing || [];
      if (!missing.length) { setNotice(`檢查完成：${scan.total || 0} 份文件都已存在，沒有缺檔。`); return; }
      setNotice(`找到 ${missing.length} 份缺檔，開始從 Sites 補回並建立精準索引。`);
      for (const [position, document] of missing.entries()) {
        setProgress((rows) => [...rows, `${position + 1}/${missing.length} ${document.fileName}：正在補回 R2…`]);
        await api({ action: "restore", documentId: document.id, config });
        let done = false; let first = true;
        while (!done) {
          const indexed = await api({ action: "index", documentId: document.id, restart: first }) as { done?: boolean; pagesDone?: number; totalPages?: number };
          first = false; done = Boolean(indexed.done);
          setProgress((rows) => [...rows.slice(0, -1), `${position + 1}/${missing.length} ${document.fileName}：索引 ${indexed.pagesDone || 0}/${indexed.totalPages || 0} 頁${done ? "，完成" : "…"}`]);
        }
      }
      setNotice(`同步完成：已補回並重新索引 ${missing.length} 份文件；原本存在的 ${scan.existing || 0} 份已自動跳過。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "同步失敗"); }
    finally { setBusy(false); }
  }

  return <section className="sites-cloudflare-sync panel">
    <div><p>SITES → CLOUDFLARE R2</p><h2>缺檔同步</h2><span>自動比對 D1 與 R2，從 Sites 補回缺少的原稿，再逐份重建精準索引；R2 已存在的文件會自動跳過。</span></div>
    <div className="sites-cloudflare-sync-actions">
      <button type="button" className="primary-btn" onClick={() => void download()} disabled={busy}>下載 Sites 同步設定</button>
      <label className="secondary-btn">匯入同步設定<input type="file" accept="application/json,.json" hidden onChange={(event) => void importConfig(event)} /></label>
      <button type="button" className="primary-btn" onClick={() => void run()} disabled={busy || !config}>{busy ? "同步處理中…" : "開始補檔並重新索引"}</button>
    </div>
    {notice && <small role="status">{notice}</small>}
    {progress.length > 0 && <ol className="sites-cloudflare-sync-progress">{progress.map((row, index) => <li key={`${index}-${row}`}>{row}</li>)}</ol>}
  </section>;
}
