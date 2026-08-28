"use client";

import { ChangeEvent, useState } from "react";

type SyncConfig = { sourceUrl?: string; sitesUrl?: string; token: string; expiresAt?: string };
type MissingDocument = { id: number; fileName: string; storageKey: string };
type SourceDocument = { id:number;fileName:string;bookTitle:string;pageCount:number|null;sourceAvailable:boolean };
type SyncScope="all"|"pengli"|"law"|"medtech"|"accounting"|"data-structure";
const scopeLabels:Record<SyncScope,string>={all:"全部教材",pengli:"彭狸老師／行政法",law:"司律／法律",medtech:"醫檢",accounting:"會計","data-structure":"資料結構"};

export default function SitesCloudflareSyncDownload() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [scope, setScope] = useState<SyncScope>("pengli");

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
      setNotice("目前環境的同步設定已下載，有效 2 小時；請到接收教材的環境匯入後執行同步。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "無法建立同步設定"); }
    finally { setBusy(false); }
  }

  async function importConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setConfig(null);
    try {
      const parsed = JSON.parse(await file.text()) as SyncConfig;
      if (!(parsed.sourceUrl || parsed.sitesUrl) || !parsed.token) throw new Error("同步設定格式不正確");
      const sourceHost = new URL(parsed.sourceUrl || parsed.sitesUrl!).host;
      if (sourceHost === window.location.host) throw new Error("這是目前環境自己的設定，不能同步給自己。請到另一個環境的教材庫匯入這份設定。");
      setConfig(parsed); setNotice(`已匯入 ${new URL(parsed.sourceUrl || parsed.sitesUrl!).host} 的同步設定${parsed.expiresAt ? `（有效至 ${new Date(parsed.expiresAt).toLocaleString("zh-TW")}）` : ""}`);
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

  async function syncTextbooks() {
    if (busy || !config) return;
    setBusy(true); setProgress([]); setNotice(`正在讀取來源環境的「${scopeLabels[scope]}」…`);
    try {
      const manifest = await api({ action: "source-manifest", scope, config }) as { documents?: SourceDocument[] };
      const allDocuments = manifest.documents || [];
      const sourceDocuments = allDocuments.filter((document) => document.sourceAvailable);
      const unavailable = allDocuments.length - sourceDocuments.length;
      if (!sourceDocuments.length) { setNotice(allDocuments.length ? `來源環境有「${scopeLabels[scope]}」紀錄，但同步原稿不在 R2；請確認 RTX 4090 已回傳 .local-index.jsonl。` : `來源環境目前沒有「${scopeLabels[scope]}」。`); return; }
      setNotice(`找到 ${sourceDocuments.length} 份可同步教材${unavailable ? `；另有 ${unavailable} 份只有紀錄、沒有 R2 原稿，已跳過` : ""}。開始同步原稿、類科指派與精準索引。`);
      for (const [position, document] of sourceDocuments.entries()) {
        setProgress((rows) => [...rows, `${position + 1}/${sourceDocuments.length} ${document.bookTitle || document.fileName}：正在同步教材…`]);
        const imported = await api({ action: "import-document", sourceDocumentId: document.id, scope, config }) as { documentId?: number };
        if (!imported.documentId) throw new Error(`${document.fileName} 未取得目標教材編號`);
        let done = false; let first = true;
        while (!done) {
          const indexed = await api({ action: "index", documentId: imported.documentId, restart: first }) as { done?: boolean; pagesDone?: number; totalPages?: number; units?: number };
          first = false; done = Boolean(indexed.done);
          setProgress((rows) => [...rows.slice(0, -1), `${position + 1}/${sourceDocuments.length} ${document.bookTitle || document.fileName}：索引 ${indexed.pagesDone || 0}/${indexed.totalPages || 0} 頁${done ? `，完成（${indexed.units || 0} 個片段）` : "…"}`]);
        }
      }
      setNotice(`同步完成：${sourceDocuments.length} 份「${scopeLabels[scope]}」已寫入目前環境並建立精準索引。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "教材同步失敗"); }
    finally { setBusy(false); }
  }

  return <div className="sites-cloudflare-sync-stack">
    <section className="sites-cloudflare-sync panel">
      <div><p>來源環境 → 目前環境</p><h2>跨環境教材同步</h2><span>先在有教材的網站下載連線設定，再到要接收教材的網站匯入並開始同步。</span></div>
      <div className="sites-cloudflare-sync-actions">
        <label className="sites-sync-scope">同步範圍<select value={scope} onChange={(event)=>setScope(event.target.value as SyncScope)}>{(Object.keys(scopeLabels) as SyncScope[]).map((key)=><option key={key} value={key}>{scopeLabels[key]}</option>)}</select></label>
        <button type="button" className="sites-sync-action-button sites-sync-download" onClick={() => void download()} disabled={busy}><b>1</b><span>⬇ 下載連線設定</span><small>在有教材的網站操作</small></button>
        <label className="sites-sync-action-button sites-sync-import"><b>2</b><span>⬆ 匯入連線設定</span><small>在接收教材的網站操作</small><input type="file" accept="application/json,.json" hidden onChange={(event) => void importConfig(event)} /></label>
        <button type="button" className="sites-sync-action-button sites-sync-start" onClick={() => void syncTextbooks()} disabled={busy || !config}><b>3</b><span>{busy ? "同步處理中…" : config ? `開始同步${scopeLabels[scope]}` : "請先匯入連線設定"}</span><small>{config ? "同步到目前環境" : "完成步驟 2 後才能開始"}</small></button>
      </div>
      {config && <small>目前來源：{new URL(config.sourceUrl || config.sitesUrl!).host}</small>}
      {notice && <small role="status">{notice}</small>}
      {progress.length > 0 && <ol className="sites-cloudflare-sync-progress">{progress.map((row, index) => <li key={`${index}-${row}`}>{row}</li>)}</ol>}
    </section>
    <section className="sites-cloudflare-sync sites-cloudflare-sync-rescue panel">
      <div><p>SITES → CLOUDFLARE R2</p><h2>缺檔救援</h2><span>只在 Cloudflare 有文件紀錄但 R2 原稿遺失時使用；從匯入的來源補回缺檔，已存在的文件會自動跳過。</span></div>
      <div className="sites-cloudflare-sync-actions"><button type="button" className="sites-sync-action-button sites-sync-rescue-button" onClick={() => void run()} disabled={busy || !config}><span>↻ 檢查並補回缺檔</span><small>{config ? "開始檢查 R2" : "請先匯入來源連線設定"}</small></button></div>
    </section>
  </div>;
}
