"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Uploaded = { id: number; name: string; subject: string; size: string; status: string; error?: string | null };
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
  const [selected, setSelected] = useState<File | null>(null);
  const [subject, setSubject] = useState("刑法");
  const [type, setType] = useState("教科書");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setUploading(true);
    setNotice("");
    try {
      const initResponse = await fetch("/api/documents/multipart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "init", fileName: selected.name, contentType: selected.type }),
      });
      const init = await readJson(initResponse) as { key?: string; uploadId?: string; error?: string };
      if (!initResponse.ok || !init.key || !init.uploadId) throw new Error(init.error ?? "無法開始上傳");

      const chunkSize = 5 * 1024 * 1024;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (let start = 0, partNumber = 1; start < selected.size; start += chunkSize, partNumber += 1) {
        setNotice(`正在上傳第 ${partNumber} 段，共 ${Math.ceil(selected.size / chunkSize)} 段…`);
        const chunk = selected.slice(start, Math.min(start + chunkSize, selected.size));
        const partResponse = await fetch(`/api/documents/multipart?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: chunk,
        });
        const part = await readJson(partResponse) as { partNumber?: number; etag?: string; error?: string };
        if (!partResponse.ok || !part.partNumber || !part.etag) throw new Error(part.error ?? `第 ${partNumber} 段上傳失敗`);
        parts.push({ partNumber: part.partNumber, etag: part.etag });
      }

      const completeResponse = await fetch("/api/documents/multipart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          key: init.key,
          uploadId: init.uploadId,
          parts,
          fileName: selected.name,
          contentType: selected.type,
          sizeBytes: selected.size,
          subject,
          documentType: type,
        }),
      });
      const completed = await readJson(completeResponse) as { document?: { id: number }; error?: string };
      if (!completeResponse.ok) throw new Error(completed.error ?? "無法完成文件上傳");
      if (!completed.document?.id) throw new Error("文件已上傳，但未取得索引編號");
      const newId = completed.document.id;
      setFiles((current) => [{ id: newId, name: selected.name, subject, size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${type}`, status: "uploaded" }, ...current]);
      setSelected(null);
      if (fileRef.current) fileRef.current.value = "";
      setNotice("PDF 已安全保存，正在開始建立索引…");
      void startIndex(newId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件上傳失敗");
    } finally {
      setUploading(false);
    }
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
            <label className="upload-zone">
              <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => setSelected(e.target.files?.[0] ?? null)} />
              <span className="upload-icon">＋</span>
              <strong>{selected ? selected.name : "選擇或拖曳 PDF 文件"}</strong>
              <span>{selected ? `${(selected.size / 1024 / 1024).toFixed(1)} MB` : "支援書籍、講義、解題書與擬答"}</span>
            </label>
            <div className="meta-fields">
              <label className="field">科目<select value={subject} onChange={(e) => setSubject(e.target.value)}><option>刑法</option><option>刑事訴訟法</option><option>民法</option><option>民事訴訟法</option><option>憲法</option><option>行政法</option><option>商事法</option></select></label>
              <label className="field">文件類型<select value={type} onChange={(e) => setType(e.target.value)}><option>教科書</option><option>解題書</option><option>講義</option><option>歷屆試題</option><option>老師擬答</option></select></label>
            </div>
            <button className="primary-btn" type="submit" disabled={!selected || uploading}>{uploading ? "上傳中…" : "上傳並建立索引"}</button>
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
