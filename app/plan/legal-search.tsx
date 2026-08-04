"use client";

import { useEffect, useState } from "react";

type LegalResult = { documentId: number; title: string; category: string; classification: string; modifiedDate: string; sourceUrl: string; articleNo: string; hierarchy: string; content: string; excerpt: string };
type LegalDocument = { id: number; title: string; category: string; classification: string; modifiedDate: string; sourceUrl: string; articleCount: number };
type LegalArticle = { id: number; articleNo: string; hierarchy: string; content: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };

const CORE_LAWS = [
  { title: "憲法", hint: "基本權、憲政機關", query: "憲法" },
  { title: "行政法", hint: "行政處分、行政救濟", query: "行政法" },
  { title: "民法", hint: "總則、債權、物權、親屬繼承", query: "民法" },
  { title: "民事訴訟法", hint: "訴訟程序與審理", query: "民事訴訟法" },
  { title: "刑法", hint: "犯罪成立與刑事責任", query: "刑法" },
  { title: "刑事訴訟法", hint: "偵查、審判與證據", query: "刑事訴訟法" },
] as const;

function handoffPrompt(result: LegalResult) {
  return `請帶我學習「${result.title}」${result.articleNo ? `的${result.articleNo}` : ""}。法規內容如下：${result.content}\n請先用司律考試角度說明這一條的規範功能，再問我一個可以直接回答的小問題。`;
}

export function LegalSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [results, setResults] = useState<LegalResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [noteTarget, setNoteTarget] = useState<LegalResult | null>(null);
  const [noteId, setNoteId] = useState<number | "new" | "">("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<{ document: LegalDocument; articles: LegalArticle[] } | null>(null);

  useEffect(() => {
    fetch("/api/notes").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { notes?: SavedNote[] };
      setNotes(result.notes ?? []);
    });
  }, []);

  async function openDocument(id: number) {
    setError("");
    const response = await fetch(`/api/legal-documents?documentId=${id}`);
    const result = await response.json() as { document?: LegalDocument; articles?: LegalArticle[]; error?: string };
    if (!response.ok || !result.document) {
      setError(result.error ?? "法規內容讀取失敗");
      return;
    }
    setSelectedDocument({ document: result.document, articles: result.articles ?? [] });
  }

  async function search(value = query, requestedCategory = category) {
    const text = value.trim();
    if (!text) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      const response = await fetch(`/api/legal-search?q=${encodeURIComponent(text)}&category=${encodeURIComponent(requestedCategory)}`);
      const result = await response.json() as { results?: LegalResult[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "法規搜尋失敗");
      setResults(result.results ?? []);
    } catch (reason) {
      setResults([]); setError(reason instanceof Error ? reason.message : "法規搜尋失敗");
    } finally { setLoading(false); }
  }

  function handoff(result: LegalResult) {
    window.location.href = `/?prompt=${encodeURIComponent(handoffPrompt(result))}`;
  }

  function openNotePicker(result: LegalResult) {
    setNoteTarget(result);
    setNoteId(notes[0]?.id ?? "new");
    setNoteTitle(`${result.title}${result.articleNo ? ` ${result.articleNo}` : ""}`);
    setNoteMessage("");
  }

  async function addToNote() {
    if (!noteTarget || !noteId) return;
    const block = `【${noteTarget.title}${noteTarget.articleNo ? ` ${noteTarget.articleNo}` : ""}】\n${noteTarget.content || noteTarget.excerpt}\n官方來源：${noteTarget.sourceUrl || "未提供"}`;
    let response: Response;
    if (noteId === "new") {
      response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: noteTitle.trim() || "法規筆記", content: block, subject: noteTarget.category || "綜合", sourceType: "legal", sourceId: String(noteTarget.documentId), sourceLabel: "全國法規資料庫" }) });
    } else {
      const note = notes.find((item) => item.id === noteId);
      if (!note) return;
      response = await fetch("/api/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...note, content: note.content.trim() ? `${note.content.trim()}\n\n${block}` : block }) });
    }
    const result = await response.json() as { note?: SavedNote; error?: string };
    if (!response.ok) { setNoteMessage(result.error ?? "加入筆記失敗"); return; }
    if (result.note) setNotes((current) => [result.note!, ...current.filter((note) => note.id !== result.note!.id)]);
    setNoteMessage("已加入指定筆記");
    setNoteTarget(null);
  }

  return <section className="legal-search-panel" aria-label="全國法規搜尋與內容瀏覽">
    <div className="legal-search-head"><div><p>OFFICIAL LAW SEARCH</p><h2>全國法規搜尋</h2><span>輸入法規名稱、條號或關鍵字查詢；搜尋結果可直接查看完整條文與官方來源。</span></div><strong>查法條</strong></div>
    <section className="core-law-guide" aria-label="司律核心六法">
      <div className="core-law-guide-head"><div><b>司律核心六法</b><span>先從最重要的六個法科開始，需要其他法規再直接搜尋。</span></div></div>
      <div className="core-law-grid">{CORE_LAWS.map((law) => <button type="button" key={law.title} onClick={() => { setQuery(law.query); setCategory(""); void search(law.query, ""); }}><strong>{law.title}</strong><small>{law.hint}</small><span>搜尋相關法條 →</span></button>)}</div>
    </section>
    <form className="legal-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋法規名稱、條號或關鍵字，例如：刑法第271條" aria-label="法規搜尋關鍵字" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="法規類別"><option value="">全部</option><option value="法律">法律</option><option value="命令">命令</option></select><button className="primary-btn" disabled={loading}>{loading ? "搜尋中…" : "搜尋"}</button></form>
    <div className="legal-search-suggestions"><span>快速搜尋</span>{["刑法第271條", "正當防衛", "民法第184條", "行政處分"].map((item) => <button type="button" key={item} onClick={() => { setQuery(item); void search(item); }}>{item}</button>)}</div>
    {error && <p className="legal-search-error">{error}</p>}
    {searched && !loading && !error && !results.length && <div className="legal-search-empty">沒有找到相符條文。可以改用法規名稱、條號或較短的關鍵字。</div>}
    <div className="legal-result-list">{results.map((result, index) => <article className="legal-result" key={`${result.documentId}-${result.articleNo}-${index}`}><div className="legal-result-meta"><span>{result.category || "法規"}</span><b>{result.title}</b><small>{result.classification ? `${result.classification} · ` : ""}{result.articleNo || result.hierarchy || "條文"}</small></div><p>{result.excerpt}</p><footer><a href={result.sourceUrl || "#"} target="_blank" rel="noreferrer">官方來源</a><button type="button" onClick={() => void openDocument(result.documentId)}>查看內容</button><button type="button" onClick={() => openNotePicker(result)}>加入筆記</button><button type="button" onClick={() => handoff(result)}>爭點解析</button></footer>{noteTarget === result && <div className="legal-note-picker"><label>指定筆記<select value={noteId} onChange={(event) => setNoteId(event.target.value === "new" ? "new" : Number(event.target.value))}><option value="new">＋ 新增自訂筆記</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.title || "未命名筆記"}</option>)}</select></label>{noteId === "new" && <label>新筆記名稱<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /></label>}<div><button type="button" onClick={() => setNoteTarget(null)}>取消</button><button type="button" className="primary-btn" onClick={() => void addToNote()}>確認加入</button></div></div>}</article>)}</div>
    {selectedDocument && <article className="law-document-detail"><header><div><span>{selectedDocument.document.category} · {selectedDocument.document.classification || "法規"}</span><h3>{selectedDocument.document.title}</h3>{selectedDocument.document.modifiedDate && <small>官方日期：{selectedDocument.document.modifiedDate}</small>}</div><div><a href={selectedDocument.document.sourceUrl || "#"} target="_blank" rel="noreferrer">官方來源 ↗</a><button type="button" onClick={() => setSelectedDocument(null)}>關閉</button></div></header>{selectedDocument.articles.length ? selectedDocument.articles.map((article) => <section key={article.id}><h4>{article.articleNo}{article.hierarchy && <small>{article.hierarchy}</small>}</h4><p>{article.content}</p></section>) : <p className="law-browser-empty">這部法規已建立名稱，但條文尚未完成索引。</p>}</article>}
    {noteMessage && <p className="legal-note-message">{noteMessage}</p>}
  </section>;
}
