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
    [loading, setLoading] = useState(true);
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
    void load();
  }, []);
  async function read(row: Row) {
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
          <section className="grid saved-notes">
            {notes.map((note) => (
              <article key={`note-${note.id}`}>
                <div className="status">我的筆記</div>
                <h2>{note.title}</h2>
                <p>{note.content}</p>
                {note.sourceLabel && <small>來源：{note.sourceLabel}</small>}
              </article>
            ))}
          </section>
          <section className="grid questions">
            {rows.map((row) => (
              <article
                key={row.id}
                className={
                  row.status === "answered" && !row.studentReadAt
                    ? "unread"
                    : ""
                }
                onClick={() => void read(row)}
              >
                <div className="status">
                  {row.status === "answered" && !row.studentReadAt
                    ? "✉ 老師新回覆"
                    : row.status === "pending_teacher"
                      ? "等待老師回覆"
                      : "AI 已查證"}
                </div>
                <h2>{row.topic}</h2>
                <b>原 AI 回覆</b>
                <p>{row.aiReply}</p>
                <b>我的疑問</b>
                <p>{row.studentQuestion}</p>
                <b>AI 查證</b>
                <p>{row.verificationResult}</p>
                {row.teacherReply && (
                  <div className="teacher">
                    <b>彭狸老師回覆</b>
                    <p>{row.teacherReply}</p>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
