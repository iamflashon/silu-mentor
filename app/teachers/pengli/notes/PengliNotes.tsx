"use client";
import { useEffect, useState } from "react";
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
  title: string;
  content: string;
  subject: string;
  tags: string;
  sourceLabel: string;
  updatedAt: string;
};
export default function PengliNotes() {
  const [rows, setRows] = useState<Row[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<
      { kind: "note"; item: Note } | { kind: "question"; item: Row } | null
    >(null);
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
    setSelected({ kind: "question", item: row });
    if (row.status === "answered" && !row.studentReadAt) {
      await fetch("/api/teachers/pengli/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, action: "read" }),
      });
      void load();
    }
  }
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
      {loading ? (
        <p>正在載入筆記…</p>
      ) : rows.length === 0 && notes.length === 0 ? (
        <section className="empty">
          尚未加入任何筆記。你可以在法條或白話解釋視窗按「加入我的筆記」。
        </section>
      ) : (
        <>
          {notes.length > 0 && <section className="note-group saved-notes">
            <div className="group-heading"><div><small>已收藏內容</small><h2>我的筆記</h2></div><span>{notes.length} 筆</span></div>
            <div className="title-list">
            {notes.map((note) => (
              <button type="button" className="title-row" key={`note-${note.id}`} onClick={() => setSelected({ kind: "note", item: note })}>
                <div><span className="status">我的筆記</span><h3>{note.title}</h3></div>
                <div className="row-meta"><time>{new Date(note.updatedAt).toLocaleDateString("zh-TW")}</time><i aria-hidden="true">›</i></div>
              </button>
            ))}
            </div>
          </section>}
          {rows.length > 0 && <section className="note-group questions">
            <div className="group-heading"><div><small>提問與回覆</small><h2>問老師紀錄</h2></div><span>{rows.length} 筆</span></div>
            <div className="title-list">
            {rows.map((row) => (
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
                </span><h3>{row.topic}</h3></div>
                <div className="row-meta"><time>{new Date(row.createdAt).toLocaleDateString("zh-TW")}</time><i aria-hidden="true">›</i></div>
              </button>
            ))}
            </div>
          </section>
          }
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
                  <p>{selected.item.content}</p>
                  {selected.item.sourceLabel && <small>來源：{selected.item.sourceLabel}</small>}
                </>
              ) : (
                <>
                  <section><b>原 AI 回覆</b><p>{selected.item.aiReply}</p></section>
                  <section><b>我的疑問</b><p>{selected.item.studentQuestion}</p></section>
                  <section><b>AI 查證</b><p>{selected.item.verificationResult}</p></section>
                  {selected.item.teacherReply && <section className="teacher"><b>彭狸老師回覆</b><p>{selected.item.teacherReply}</p></section>}
                </>
              )}
            </div>
            <footer><button type="button" onClick={() => setSelected(null)}>關閉</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
