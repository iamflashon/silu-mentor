"use client";

import { useEffect, useState } from "react";

type LegalResult = { documentId: number; title: string; category: string; modifiedDate: string; sourceUrl: string; articleNo: string; hierarchy: string; content: string; excerpt: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };

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

  useEffect(() => {
    fetch("/api/notes").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { notes?: SavedNote[] };
      setNotes(result.notes ?? []);
    });
  }, []);

  async function search(value = query) {
    const text = value.trim();
    if (!text) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      const response = await fetch(`/api/legal-search?q=${encodeURIComponent(text)}&category=${encodeURIComponent(category)}`);
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

  return <section className="legal-search-panel" aria-label="全國法規搜尋">
    <div className="legal-search-head"><div><p>OFFICIAL LAW SEARCH</p><h2>全國法規搜尋</h2><span>直接查已匯入的法律與命令；找到條文後，可以帶入 AI 司律作戰中心繼續學。</span></div><strong>法律／命令</strong></div>
    <form className="legal-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋法規名稱、條號或關鍵字，例如：刑法第271條" aria-label="法規搜尋關鍵字" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="法規類別"><option value="">全部</option><option value="法律">法律</option><option value="命令">命令</option></select><button className="primary-btn" disabled={loading}>{loading ? "搜尋中…" : "搜尋"}</button></form>
    <div className="legal-search-suggestions"><span>快速搜尋</span>{["刑法第271條", "正當防衛", "民法第184條", "行政處分"].map((item) => <button key={item} onClick={() => { setQuery(item); void search(item); }}>{item}</button>)}</div>
    {error && <p className="legal-search-error">{error}</p>}
    {searched && !loading && !error && !results.length && <div className="legal-search-empty">沒有找到相符條文。可以改用法規名稱、條號或較短的關鍵字。</div>}
    <div className="legal-result-list">{results.map((result, index) => <article className="legal-result" key={`${result.documentId}-${result.articleNo}-${index}`}><div className="legal-result-meta"><span>{result.category || "法規"}</span><b>{result.title}</b><small>{result.articleNo || result.hierarchy || "條文"}</small></div><p>{result.excerpt}</p><footer><a href={result.sourceUrl || "#"} target="_blank" rel="noreferrer">官方來源</a><button onClick={() => openNotePicker(result)}>加入筆記</button><button onClick={() => handoff(result)}>帶入 AI 對話</button></footer>{noteTarget === result && <div className="legal-note-picker"><label>指定筆記<select value={noteId} onChange={(event) => setNoteId(event.target.value === "new" ? "new" : Number(event.target.value))}><option value="new">＋ 新增自訂筆記</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.title || "未命名筆記"}</option>)}</select></label>{noteId === "new" && <label>新筆記名稱<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /></label>}<div><button onClick={() => setNoteTarget(null)}>取消</button><button className="primary-btn" onClick={() => void addToNote()}>確認加入</button></div></div>}</article>)}</div>
    {noteMessage && <p className="legal-note-message">{noteMessage}</p>}
  </section>;
}
