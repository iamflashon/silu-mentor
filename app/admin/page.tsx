"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Uploaded = { id: number; name: string; subject: string; size: string; status: string; error?: string | null };
type QueueItem = { key: string; file: File; status: "queued" | "uploading" | "indexing" | "done" | "failed"; progress: number; error?: string };
type UsageData = {
  totals: { requests: number; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; costMicros: number };
  recent: Array<{ id: number; model: string; source: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsdMicros: number; createdAt: string }>;
  showCosts: boolean;
};

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (response.status === 413) return { error: "檔案超過單次上傳限制，請重新選擇文件" };
    return { error: "伺服器暫時無法處理這份文件" };
  }
}

export default function AdminPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [subject, setSubject] = useState("刑法");
  const [type, setType] = useState("教科書");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/documents").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { documents?: Array<{ id: number; name: string; subject: string; type: string; sizeBytes: number; status: string; error?: string | null }> };
      setFiles((result.documents ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        subject: item.subject,
        size: `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${item.type}`,
        status: item.status,
        error: item.error,
      })));
    }).catch(() => undefined);
    fetch("/api/usage").then(async (response) => {
      if (response.ok) setUsage(await response.json() as UsageData);
    }).catch(() => undefined);
  }, []);

  async function toggleFrontendCosts() {
    if (!usage) return;
    const next = !usage.showCosts;
    const response = await fetch("/api/usage", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showCosts: next }),
    });
    if (response.ok) setUsage({ ...usage, showCosts: next });
  }

  async function startIndex(documentId: number) {
    setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: "uploading_to_index", error: null } : item));
    setNotice("正在把 PDF 送入教材索引服務…");
    try {
      const response = await fetch("/api/documents/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const result = await readJson(response) as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "建立索引失敗");
      setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: result.status ?? "in_progress" } : item));
      setNotice("索引服務已接收文件，完成後會自動改為「可供搜尋」。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "建立索引失敗";
      setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: "failed", error: message } : item));
      setNotice(message);
    }
  }

  function chooseFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    const pdfs = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const rejected = incoming.length - pdfs.length;
    setQueue((current) => {
      const known = new Set(current.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
      const additions = pdfs.filter((file) => !known.has(`${file.name}-${file.size}-${file.lastModified}`)).map((file, index) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`, file, status: "queued" as const, progress: 0 }));
      return [...current, ...additions];
    });
    setNotice(pdfs.length ? `已加入 ${pdfs.length} 份 PDF${rejected ? `，另排除 ${rejected} 個非 PDF 檔案` : ""}。確認科目與類型後即可依序上傳。` : "拖入的檔案沒有 PDF，請重新選擇。");
  }

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function uploadOne(item: QueueItem, position: number, total: number) {
    const selected = item.file;
    patchQueue(item.key, { status: "uploading", progress: 0, error: undefined });
    setNotice(`正在處理第 ${position}／${total} 本：${selected.name}`);

    const initResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "init", fileName: selected.name, contentType: "application/pdf" }),
    });
    const init = await readJson(initResponse) as { key?: string; uploadId?: string; error?: string };
    if (!initResponse.ok || !init.key || !init.uploadId) throw new Error(init.error ?? "無法開始上傳");

    const chunkSize = 5 * 1024 * 1024;
    const totalParts = Math.ceil(selected.size / chunkSize);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let start = 0, partNumber = 1; start < selected.size; start += chunkSize, partNumber += 1) {
      const chunk = selected.slice(start, Math.min(start + chunkSize, selected.size));
      const partResponse = await fetch(`/api/documents/multipart?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: chunk,
      });
      const part = await readJson(partResponse) as { partNumber?: number; etag?: string; error?: string };
      if (!partResponse.ok || !part.partNumber || !part.etag) throw new Error(part.error ?? `第 ${partNumber} 段上傳失敗`);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      patchQueue(item.key, { progress: Math.round(partNumber / totalParts * 85) });
    }

    const completeResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", key: init.key, uploadId: init.uploadId, parts, fileName: selected.name, contentType: "application/pdf", sizeBytes: selected.size, subject, documentType: type }),
    });
    const completed = await readJson(completeResponse) as { document?: { id: number }; error?: string };
    if (!completeResponse.ok || !completed.document?.id) throw new Error(completed.error ?? "無法完成文件上傳");
    const newId = completed.document.id;
    setFiles((current) => [{ id: newId, name: selected.name, subject, size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${type}`, status: "uploaded" }, ...current]);
    patchQueue(item.key, { status: "indexing", progress: 92 });

    const indexResponse = await fetch("/api/documents/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: newId }) });
    const indexed = await readJson(indexResponse) as { status?: string; error?: string };
    if (!indexResponse.ok) throw new Error(indexed.error ?? "建立索引失敗");
    setFiles((current) => current.map((file) => file.id === newId ? { ...file, status: indexed.status ?? "in_progress" } : file));
    patchQueue(item.key, { status: "done", progress: 100 });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pending = queue.filter((item) => item.status === "queued" || item.status === "failed");
    if (!pending.length) return;
    setUploading(true);
    setNotice("");
    let failed = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      try { await uploadOne(item, index + 1, pending.length); }
      catch (error) { failed += 1; patchQueue(item.key, { status: "failed", error: error instanceof Error ? error.message : "文件上傳失敗" }); }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    setNotice(failed ? `批次處理完成：${pending.length - failed} 本成功，${failed} 本失敗，可按下方按鈕重試失敗項目。` : `${pending.length} 本 PDF 已依序上傳，索引服務正在處理。`);
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark">律</span><span>司律導師</span></Link>
        <Link href="/" className="back-link">返回對話首頁 →</Link>
      </header>
      <div className="admin-main">
        <div className="admin-title">
          <div><p>CONTENT MANAGEMENT</p><h1>教材知識庫</h1></div>
        </div>
        <section className="cost-panel panel">
          <div className="cost-heading">
            <div><h2>AI 使用成本</h2><p className="panel-sub">依實際 API usage 記錄，供未來方案與收費評估。</p></div>
            <label className="cost-toggle"><input type="checkbox" checked={usage?.showCosts ?? false} onChange={toggleFrontendCosts} /><span />前台顯示成本</label>
          </div>
          <div className="cost-metrics">
            <div><span>累計對話</span><strong>{Number(usage?.totals.requests ?? 0).toLocaleString()}</strong></div>
            <div><span>輸入 Token</span><strong>{Number(usage?.totals.inputTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>輸出 Token</span><strong>{Number(usage?.totals.outputTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>快取 Token</span><strong>{Number(usage?.totals.cachedTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>教材搜尋</span><strong>{Number(usage?.totals.fileSearchCalls ?? 0).toLocaleString()}</strong></div>
            <div className="cost-total"><span>估算總成本</span><strong>US$ {(Number(usage?.totals.costMicros ?? 0) / 1_000_000).toFixed(4)}</strong></div>
          </div>
          {usage?.recent?.length ? <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>時間</th><th>模型</th><th>依據</th><th>輸入</th><th>快取</th><th>輸出</th><th>搜尋</th><th>成本</th></tr></thead><tbody>{usage.recent.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>{row.model.replace("gpt-5.6-", "")}</td><td>{row.source}</td><td>{row.inputTokens.toLocaleString()}</td><td>{row.cachedTokens.toLocaleString()}</td><td>{row.outputTokens.toLocaleString()}</td><td>{row.fileSearchCalls}</td><td>US$ {(row.estimatedCostUsdMicros / 1_000_000).toFixed(5)}</td></tr>)}</tbody></table></div> : <p className="usage-empty">新版本發布後產生的 AI 對話，會開始記錄在這裡。</p>}
        </section>
        <div className="admin-grid">
          <form className="panel" onSubmit={submit}>
            <h2>上傳教材</h2>
            <p className="panel-sub">PDF 將自動解析、切分並建立搜尋索引，供司律導師回答與教學。</p>
            <label className={`upload-zone ${dragActive ? "drag-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragActive(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!uploading) setDragActive(true); }} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!uploading) chooseFiles(Array.from(event.dataTransfer.files)); }}>
              <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => chooseFiles(e.target.files)} />
              <span className="upload-icon">＋</span>
              <strong>{dragActive ? "放開滑鼠，加入批次佇列" : queue.length ? `已選擇 ${queue.length} 份 PDF` : "拖曳大量 PDF 到這裡"}</strong>
              <span>{queue.length ? `共 ${(queue.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(1)} MB · 還可以繼續拖入更多檔案` : "或點此批次選取；系統將逐本上傳與建立索引"}</span>
            </label>
            {queue.length > 0 && <div className="upload-queue">{queue.map((item, index) => <div className="queue-row" key={item.key}><div className="queue-index">{index + 1}</div><div className="queue-main"><div><strong>{item.file.name}</strong><span>{item.status === "queued" ? "等待上傳" : item.status === "uploading" ? `上傳中 ${item.progress}%` : item.status === "indexing" ? "送入索引中" : item.status === "done" ? "已送出索引" : `失敗 · ${item.error ?? "請重試"}`}</span></div><div className="queue-progress"><i style={{ width: `${item.progress}%` }} /></div></div></div>)}</div>}
            <div className="meta-fields">
              <label className="field">科目<select value={subject} onChange={(e) => setSubject(e.target.value)}><option>刑法</option><option>刑事訴訟法</option><option>民法</option><option>民事訴訟法</option><option>憲法</option><option>行政法</option><option>商事法</option></select></label>
              <label className="field">文件類型<select value={type} onChange={(e) => setType(e.target.value)}><option>教科書</option><option>解題書</option><option>講義</option><option>歷屆試題</option><option>老師擬答</option></select></label>
            </div>
            <button className="primary-btn" type="submit" disabled={!queue.some((item) => item.status === "queued" || item.status === "failed") || uploading}>{uploading ? "批次處理中，請勿關閉頁面…" : queue.some((item) => item.status === "failed") ? "重試失敗項目" : `依序上傳 ${queue.length || ""} 份並建立索引`}</button>
            {notice && <div className="notice">{notice}</div>}
          </form>
          <section className="panel">
            <h2>文件處理狀態</h2>
            <p className="panel-sub">只有完成索引的內容，才會進入教材優先檢索。</p>
            {files.length === 0 ? <div className="empty-state">尚未上傳教材<br />第一份 PDF 會顯示在這裡</div> : (
              <div className="file-list">{files.map((file) => {
                const ready = file.status === "completed";
                const failed = file.status === "failed";
                const waiting = file.status === "uploaded";
                return <div className="file-card" key={file.id}><span className="file-type">PDF</span><div className="file-info"><strong>{file.name}</strong><span>{file.subject} · {file.size}{file.error ? ` · ${file.error}` : ""}</span></div>{waiting || failed ? <button className="index-btn" onClick={() => startIndex(file.id)}>{failed ? "重新索引" : "開始索引"}</button> : <span className={`status ${ready ? "" : "pending"}`}>{ready ? "可供搜尋" : "建立索引中"}</span>}</div>;
              })}</div>
            )}
            <div className="notice">正式接入後，這裡會顯示頁數、切分段落數、索引版本、被引用次數，以及「教材找不到」的使用者問題。</div>
          </section>
        </div>
      </div>
    </main>
  );
}
