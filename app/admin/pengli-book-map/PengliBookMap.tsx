"use client";

import { useEffect, useMemo, useState } from "react";

type Section = { sectionKey: string; title: string; sectionType: string; sortOrder: number; pdfStartPage: number; pdfEndPage: number; verified: boolean };
type Book = { id: number; title: string; fileName: string; totalPages: number; hasPdf: boolean };

export default function PengliBookMap() {
  const [book, setBook] = useState<Book | null>(null), [sections, setSections] = useState<Section[]>([]), [active, setActive] = useState(1), [page, setPage] = useState(23), [notice, setNotice] = useState(""), [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false);
  const load = async () => {
    const response = await fetch("/api/admin/pengli-book-map", { cache: "no-store" }), data = await response.json() as { document?: Book; sections?: Section[]; error?: string };
    if (!response.ok) { setNotice(data.error || "無法讀取書本對照資料。"); return; }
    setBook(data.document || null); setSections(data.sections || []);
  };
  useEffect(() => {
    // Initial remote synchronization; state changes happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);
  const selected = sections[active];
  const completed = useMemo(() => sections.filter((item) => item.pdfStartPage > 0 && item.pdfEndPage >= item.pdfStartPage).length, [sections]);
  const bookPage = selected?.sectionType === "body" && selected.pdfStartPage > 0 && page >= selected.pdfStartPage ? `${selected.sortOrder}-${page - selected.pdfStartPage + 1}` : "前置頁";
  const bookRange = (section: Section) => section.sectionType === "body" && section.pdfStartPage > 0 && section.pdfEndPage >= section.pdfStartPage ? `書頁 ${section.sortOrder}-1–${section.sortOrder}-${section.pdfEndPage - section.pdfStartPage + 1}` : "";
  function update(index: number, key: "pdfStartPage" | "pdfEndPage", value: number) {
    const normalized = Math.max(0, value);
    setSections((rows) => rows.map((row, i) => {
      if (i === index) return { ...row, [key]: normalized, verified: false };
      if (key === "pdfEndPage" && normalized > 0 && i === index + 1 && row.sectionType === "body") {
        const nextStart = normalized + 1;
        return { ...row, pdfStartPage: nextStart, pdfEndPage: row.pdfEndPage >= nextStart ? row.pdfEndPage : 0, verified: false };
      }
      return row;
    }));
  }
  function markStart() {
    setSections((rows) => rows.map((row, index) => index === active ? { ...row, pdfStartPage: page, pdfEndPage: row.pdfEndPage >= page ? row.pdfEndPage : 0, verified: false } : index === active - 1 && row.sectionType === "body" ? { ...row, pdfEndPage: page - 1, verified: false } : row));
  }
  function markEnd() { update(active, "pdfEndPage", page); }
  async function save() {
    setSaving(true); setNotice("");
    const response = await fetch("/api/admin/pengli-book-map", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sections }) }), data = await response.json() as { error?: string };
    setSaving(false); setNotice(response.ok ? "已儲存章節與 PDF 實際頁的對照；學生問答與書頁測試會依這份頁段執行。" : data.error || "儲存失敗。");
    if (response.ok) await load();
  }
  async function upload(file: File) {
    if (!book) return; setUploading(true); setNotice("");
    const form = new FormData(); form.set("id", String(book.id)); form.set("file", file);
    const response = await fetch("/api/admin/pengli-book-map/source", { method: "POST", body: form }), data = await response.json() as { error?: string };
    setUploading(false); setNotice(response.ok ? "私有 PDF 原稿已保存；學生端無法開啟原檔。" : data.error || "PDF 上傳失敗。");
    if (response.ok) await load();
  }
  if (!book) return <section className="pengli-map-loading">{notice || "正在讀取彭狸教材…"}</section>;
  return <section className="pengli-map-shell">
    <header className="pengli-map-head"><div><span>BOOK ALIGNMENT</span><h1>書本對照區</h1><p>以 PDF 實際頁碼校正八大主題；目錄與前置頁不供 AI 當作正文。</p></div><div className="pengli-map-status"><b>{completed} / {sections.length}</b><small>頁段已完整</small></div></header>
    {notice && <p className="pengli-map-notice">{notice}</p>}
    <div className="pengli-map-grid">
      <aside className="pengli-map-sections">
        <div className="pengli-map-book"><b>{book.title}</b><small>{book.fileName}</small><span>索引總頁數：{book.totalPages || "待確認"}</span></div>
        {sections.map((section, index) => <button type="button" key={section.sectionKey} className={`${index === active ? "active" : ""} ${section.sectionType === "front_matter" ? "front" : ""}`} onClick={() => { setActive(index); setPage(section.pdfStartPage || Math.max(23, page)); }}>
          <span>{index === 0 ? "前置" : String(index).padStart(2, "0")}</span><div><b>{section.title}</b><small>{section.pdfStartPage > 0 && section.pdfEndPage >= section.pdfStartPage ? `PDF ${section.pdfStartPage}–${section.pdfEndPage} 頁${bookRange(section) ? `｜${bookRange(section)}` : ""}` : section.pdfStartPage > 0 ? `起點 PDF ${section.pdfStartPage} 頁，尚未設定終點` : "尚未對照"}</small></div><i>{section.verified ? "已核對" : "待核對"}</i>
        </button>)}
      </aside>
      <section className="pengli-map-workspace">
        <header><div><b>{selected?.title}</b><small className="pengli-page-pair"><strong>PDF 第 {page} 頁</strong><span>=</span><strong>書內第 {bookPage} 頁</strong></small></div><div className="pengli-page-nav"><button onClick={() => setPage((value) => Math.max(1, value - 1))}>上一頁</button><label>PDF 實際頁<input aria-label="PDF 實際頁碼" type="number" min="1" max={book.totalPages || undefined} value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}/></label><button onClick={() => setPage((value) => Math.min(book.totalPages || 9999, value + 1))}>下一頁</button></div></header>
        {book.hasPdf ? <iframe key={page} title="私有 PDF 原稿" src={`/api/admin/pengli-book-map/source?id=${book.id}&locate=${page}#page=${page}&zoom=page-width&pagemode=thumbs`}/> : <div className="pengli-pdf-empty"><b>目前只有逐頁索引，尚未保存私有 PDF 原稿</b><p>上傳後只供管理後台核對，學生端不會取得 PDF。</p><label>{uploading ? "上傳中…" : "上傳受保護的 PDF 原稿"}<input type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}/></label></div>}
        <div className="pengli-map-controls"><div><label>PDF 實際起始頁<input type="number" min="0" value={selected?.pdfStartPage || 0} onChange={(event) => update(active, "pdfStartPage", Number(event.target.value) || 0)}/></label><label>PDF 實際結束頁<input type="number" min="0" value={selected?.pdfEndPage || 0} onChange={(event) => update(active, "pdfEndPage", Number(event.target.value) || 0)}/></label><span className="pengli-range-pair">{selected?.sectionType === "body" && selected.pdfStartPage > 0 && selected.pdfEndPage >= selected.pdfStartPage ? `對應書內 ${selected.sortOrder}-1～${selected.sortOrder}-${selected.pdfEndPage - selected.pdfStartPage + 1}` : "完成 PDF 起訖頁後自動換算書內頁碼"}</span></div><div><button onClick={markStart}>將 PDF {page} 設為起點</button><button onClick={markEnd}>將 PDF {page} 設為終點</button><button className="save" disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存全部對照"}</button></div></div>
      </section>
    </div>
  </section>;
}
