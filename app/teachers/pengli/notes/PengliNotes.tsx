"use client";
import { useEffect, useMemo, useState } from "react";
const PAGE_SIZE = 8;
type Row = {
  id: number;
  topic: string;
  aiReply: string;
  studentQuestion: string;
  verificationResult: string;
  verificationSources: { label: string; url?: string }[];
  status: string;
  teacherReply: string;
  teacherRepliedAt?: string | null;
  studentReadAt?: string | null;
  createdAt: string;
};
type Note = {
  id: number;
  sourceId?: string | null;
  title: string;
  content: string;
  subject: string;
  tags: string;
  sourceLabel: string;
  updatedAt: string;
};
function summary(value: string, length = 82) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
export default function PengliNotes() {
  const [rows, setRows] = useState<Row[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<
      { kind: "note"; item: Note } | { kind: "question"; item: Row } | null
    >(null),
    [query, setQuery] = useState(""),
    [notePage, setNotePage] = useState(1),
    [questionPage, setQuestionPage] = useState(1),
    [draftTitle, setDraftTitle] = useState(""),
    [draftContent, setDraftContent] = useState(""),
    [supplement, setSupplement] = useState(""),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const [questionsResponse, notesResponse] = await Promise.all([
      fetch("/api/teachers/pengli/questions", { cache: "no-store" }),
      fetch("/api/notes?category=pengli", { cache: "no-store" }),
    ]);
    if (questionsResponse.ok) {
      const data = await questionsResponse.json();
      setRows(data.rows || []);
    }
    if (notesResponse.ok) {
      const data = await notesResponse.json();
      setNotes(data.notes || []);
    }
    setLoading(false);
  }
  useEffect(() => {
    // The initial request hydrates this client-only notes view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);
  useEffect(() => {
    if (!selected) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);
  async function read(row: Row) {
    const extra = notes.find((note) => note.sourceId === `pengli-question-${row.id}`);
    setSelected({ kind: "question", item: row });
    setSupplement(extra?.content || "");
    setMessage("");
    if (row.status === "answered" && !row.studentReadAt) {
      await fetch("/api/teachers/pengli/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, action: "read" }),
      });
      void load();
    }
  }
  function openNote(note: Note) {
    setSelected({ kind: "note", item: note });
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setMessage("");
  }
  async function saveDetail() {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      if (selected.kind === "note") {
        const response = await fetch("/api/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.item.id, title: draftTitle, content: draftContent, subject: selected.item.subject, tags: selected.item.tags, category: "pengli" }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "儲存失敗");
        setSelected({ kind: "note", item: { ...selected.item, title: draftTitle.trim() || "我的筆記", content: draftContent } });
      } else {
        const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceType: "note", sourceId: `pengli-question-${selected.item.id}`, title: `補充：${selected.item.topic}`, content: supplement, subject: "行政法", tags: "彭狸老師專區,問老師補充", sourceLabel: "彭狸老師專區｜問老師紀錄" }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "儲存失敗");
      }
      await load();
      setMessage("已儲存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }
  const visibleNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return notes.filter((note) => !note.sourceId?.startsWith("pengli-question-") && (!keyword || [note.title, note.content, note.subject, note.tags, note.sourceLabel].some((value) => value?.toLowerCase().includes(keyword))));
  }, [notes, query]);
  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      const extra = notes.find((note) => note.sourceId === `pengli-question-${row.id}`)?.content || "";
      return !keyword || [row.topic, row.aiReply, row.studentQuestion, row.verificationResult, row.teacherReply, extra].some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [rows, notes, query]);
  const notePages = Math.max(1, Math.ceil(visibleNotes.length / PAGE_SIZE));
  const questionPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pagedNotes = visibleNotes.slice((Math.min(notePage, notePages) - 1) * PAGE_SIZE, Math.min(notePage, notePages) * PAGE_SIZE);
  const pagedRows = visibleRows.slice((Math.min(questionPage, questionPages) - 1) * PAGE_SIZE, Math.min(questionPage, questionPages) * PAGE_SIZE);
  return (
    <main className="pengli-notes">
      <header>
        <div>
          <small>彭狸老師專區</small>
          <h1>我的筆記</h1>
          <p>保存我選擇加入的法條、白話解釋、AI 查證與老師本人回覆。</p>
        </div>
        <a href="/teachers/pengli/coach">← 回去繼續對話</a>
      </header>
      <section className="notes-search"><label htmlFor="pengli-note-search">搜尋筆記與問老師紀錄</label><div><span aria-hidden="true">⌕</span><input id="pengli-note-search" value={query} onChange={(event) => { setQuery(event.target.value); setNotePage(1); setQuestionPage(1); }} placeholder="搜尋標題、內容、疑問或老師回覆…" />{query && <button type="button" onClick={() => setQuery("")}>清除</button>}</div></section>
      {loading ? (
        <p>正在載入筆記…</p>
      ) : rows.length === 0 && notes.length === 0 ? (
        <section className="empty">
          尚未加入任何筆記。你可以在法條或白話解釋視窗按「加入我的筆記」。
        </section>
      ) : (
        <>
          {visibleNotes.length > 0 && <section className="note-group saved-notes">
            <div className="group-heading"><div><small>已收藏內容</small><h2>我的筆記</h2></div><span>{visibleNotes.length} 筆</span></div>
            <div className="title-list">
            {pagedNotes.map((note) => (
              <button type="button" className="title-row" key={`note-${note.id}`} onClick={() => openNote(note)}>
                <div><span className="status">我的筆記</span><h3>{note.title}</h3><p>{summary(note.content) || "尚未填寫內容"}</p></div>
                <div className="row-meta"><time>{new Date(note.updatedAt).toLocaleDateString("zh-TW")}</time><i aria-hidden="true">›</i></div>
              </button>
            ))}
            </div>
            {notePages > 1 && <nav className="pagination" aria-label="我的筆記分頁"><button type="button" disabled={notePage <= 1} onClick={() => setNotePage((page) => Math.max(1, page - 1))}>上一頁</button><span>第 {Math.min(notePage, notePages)}／{notePages} 頁</span><button type="button" disabled={notePage >= notePages} onClick={() => setNotePage((page) => Math.min(notePages, page + 1))}>下一頁</button></nav>}
          </section>}
          {visibleRows.length > 0 && <section className="note-group questions">
            <div className="group-heading"><div><small>提問與回覆</small><h2>問老師紀錄</h2></div><span>{visibleRows.length} 筆</span></div>
            <div className="title-list">
            {pagedRows.map((row) => (
              <button type="button"
                key={row.id}
                className={`title-row ${
                  row.status === "answered" && !row.studentReadAt
                    ? "unread"
                    : ""
                }`}
                onClick={() => void read(row)}
              >
                <div><span className="status">
                  {row.status === "answered" && !row.studentReadAt
                    ? "✉ 老師新回覆"
                    : row.status === "pending_teacher"
                      ? "等待老師回覆"
                      : row.status === "pending_review"
                      ? "等待管理員確認"
                      : "AI 已查證"}
                </span><h3>{row.topic}</h3><p>{summary(row.studentQuestion) || summary(row.aiReply)}</p></div>
                <div className="row-meta"><time>{new Date(row.createdAt).toLocaleDateString("zh-TW")}</time><i aria-hidden="true">›</i></div>
              </button>
            ))}
            </div>
            {questionPages > 1 && <nav className="pagination" aria-label="問老師紀錄分頁"><button type="button" disabled={questionPage <= 1} onClick={() => setQuestionPage((page) => Math.max(1, page - 1))}>上一頁</button><span>第 {Math.min(questionPage, questionPages)}／{questionPages} 頁</span><button type="button" disabled={questionPage >= questionPages} onClick={() => setQuestionPage((page) => Math.min(questionPages, page + 1))}>下一頁</button></nav>}
          </section>
          }
          {query && visibleNotes.length === 0 && visibleRows.length === 0 && <section className="empty">找不到符合「{query}」的筆記或問老師紀錄。</section>}
        </>
      )}
      {selected && (
        <div className="note-detail-backdrop" onMouseDown={() => setSelected(null)}>
          <section className="note-detail" role="dialog" aria-modal="true" aria-labelledby="note-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>{selected.kind === "note" ? "我的筆記" : "問老師紀錄"}</small>
                <h2 id="note-detail-title">{selected.kind === "note" ? selected.item.title : selected.item.topic}</h2>
              </div>
              <button type="button" className="detail-close" onClick={() => setSelected(null)} aria-label="關閉內容">×</button>
            </header>
            <div className="note-detail-body">
              {selected.kind === "note" ? (
                <>
                  <label className="edit-field">筆記標題<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} /></label>
                  <label className="edit-field">筆記內容與補充<textarea rows={12} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} /></label>
                  {selected.item.sourceLabel && <small>來源：{selected.item.sourceLabel}</small>}
                </>
              ) : (
                <>
                  <section><b>原 AI 回覆</b><p>{selected.item.aiReply}</p></section>
                  <section><b>我的疑問</b><p>{selected.item.studentQuestion}</p></section>
                  <section><b>AI 查證</b><p>{selected.item.verificationResult}</p></section>
                  {selected.item.teacherReply && <section className="teacher"><b>彭狸老師回覆</b><p>{selected.item.teacherReply}</p></section>}
                  <label className="edit-field supplement">我的補充筆記<textarea rows={7} value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="可以在這裡補充自己的理解、考點或待複習內容…" /></label>
                </>
              )}
            </div>
            <footer>{message && <span className={message === "已儲存" ? "saved" : "error"}>{message}</span>}<div><button type="button" onClick={() => setSelected(null)}>關閉</button><button type="button" className="save-detail" disabled={saving} onClick={() => void saveDetail()}>{saving ? "儲存中…" : "儲存修改"}</button></div></footer>
          </section>
        </div>
      )}
    </main>
  );
}
