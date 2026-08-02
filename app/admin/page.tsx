"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Uploaded = { name: string; subject: string; size: string; pending: boolean };

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

  useEffect(() => {
    fetch("/api/documents").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { documents?: Array<{ name: string; subject: string; type: string; sizeBytes: number; status: string }> };
      setFiles((result.documents ?? []).map((item) => ({
        name: item.name,
        subject: item.subject,
        size: `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${item.type}`,
        pending: item.status !== "indexed",
      })));
    }).catch(() => undefined);
  }, []);

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
      const completed = await readJson(completeResponse) as { error?: string };
      if (!completeResponse.ok) throw new Error(completed.error ?? "無法完成文件上傳");
      setFiles((current) => [{ name: selected.name, subject, size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${type}`, pending: true }, ...current]);
      setSelected(null);
      if (fileRef.current) fileRef.current.value = "";
      setNotice("PDF 已安全保存，等待文字解析與索引作業。");
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
              <div className="file-list">{files.map((file, index) => <div className="file-card" key={`${file.name}-${index}`}><span className="file-type">PDF</span><div className="file-info"><strong>{file.name}</strong><span>{file.subject} · {file.size}</span></div><span className={`status ${file.pending ? "pending" : ""}`}>{file.pending ? "等待建立索引" : "可供搜尋"}</span></div>)}</div>
            )}
            <div className="notice">正式接入後，這裡會顯示頁數、切分段落數、索引版本、被引用次數，以及「教材找不到」的使用者問題。</div>
          </section>
        </div>
      </div>
    </main>
  );
}
