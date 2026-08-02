"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Uploaded = { name: string; subject: string; size: string; pending: boolean };

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
    const form = new FormData();
    form.set("file", selected);
    form.set("subject", subject);
    form.set("documentType", type);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "上傳失敗");
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
