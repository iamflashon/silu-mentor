"use client";

import { useEffect, useMemo, useState } from "react";

type Attachment = { id: number; url: string };
type Note = { id: number; sourceType?: string; title: string; content: string; originalContent?: string; subject: string; tags: string; sourceLabel: string; updatedAt: string; attachments?: Attachment[] };
type Filter = "all" | "favorite" | "note";

const emptyDraft = (): Note => ({ id: 0, sourceType: "note", title: "", content: "", subject: "綜合", tags: "", sourceLabel: "", updatedAt: new Date().toISOString(), attachments: [] });

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const pageSize = 12;

  async function loadNotes() {
    setLoading(true);
    const response = await fetch("/api/notes?category=law");
    if (response.ok) setNotes(((await response.json()) as { notes?: Note[] }).notes ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadNotes(); }, []);

  const filtered = useMemo(() => notes.filter((note) => {
    if (filter === "favorite" && note.sourceType !== "favorite") return false;
    if (filter === "note" && note.sourceType === "favorite") return false;
    const term = query.trim().toLowerCase();
    return !term || [note.title, note.content, note.originalContent, note.subject, note.tags, note.sourceLabel].some((value) => value?.toLowerCase().includes(term));
  }), [notes, query, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function chooseFilter(next: Filter) { setFilter(next); setPage(1); setSelectedIds(new Set()); }

  function toggleSelected(id: number) {
    setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAllFiltered() {
    const filteredIds = filtered.map((note) => note.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(filteredIds));
  }

  async function removeSelected() {
    const ids = [...selectedIds];
    if (!ids.length || !window.confirm(`確定要刪除選取的 ${ids.length} 則筆記嗎？\n\n原始收藏、AI 整理內容與附件都會一併刪除，且無法復原。`)) return;
    setDeleting(true); setMessage("");
    const response = await fetch("/api/notes", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, category: "law" }) });
    const result = await response.json().catch(() => ({})) as { ids?: number[]; error?: string };
    setDeleting(false);
    if (!response.ok) { setMessage(result.error ?? "目前無法刪除，請稍後再試。"); return; }
    const deletedIds = new Set(result.ids ?? ids);
    setNotes((items) => items.filter((item) => !deletedIds.has(item.id)));
    setSelectedIds(new Set());
  }

  async function save() {
    if (!draft?.title.trim() || !draft.content.trim()) { setMessage("請填寫標題與筆記內容。"); return; }
    setSaving(true); setMessage("");
    const create = !draft.id;
    const response = await fetch("/api/notes", { method: create ? "POST" : "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: draft.id, category: "law", sourceType: draft.sourceType || "note", title: draft.title, content: draft.content, subject: draft.subject, tags: draft.tags, sourceLabel: draft.sourceLabel }) });
    setSaving(false);
    if (!response.ok) { setMessage("目前無法儲存，請稍後再試。"); return; }
    await loadNotes(); setDraft(null);
  }

  async function remove() {
    if (!draft?.id || !window.confirm("確定刪除這則筆記？刪除後無法復原。")) return;
    const response = await fetch(`/api/notes?id=${draft.id}&category=law`, { method: "DELETE" });
    if (response.ok) { setNotes((items) => items.filter((item) => item.id !== draft.id)); setDraft(null); }
  }

  return <main className="notes-page">
    <header className="notes-page-header"><a href="/law" className="notes-home-link"><span>律</span>回首頁</a><div><p>MY STUDY NOTES</p><h1>我的筆記</h1><small>收藏與筆記集中在這裡，不必進入學習專區。</small></div><button type="button" onClick={() => setDraft(emptyDraft())}>＋ 新增筆記</button></header>
    <section className="notes-toolbar"><div className="notes-filters" role="group" aria-label="筆記類型"><button className={filter === "all" ? "active" : ""} onClick={() => chooseFilter("all")}>全部 <b>{notes.length}</b></button><button className={filter === "favorite" ? "active" : ""} onClick={() => chooseFilter("favorite")}>快速收藏 <b>{notes.filter((note) => note.sourceType === "favorite").length}</b></button><button className={filter === "note" ? "active" : ""} onClick={() => chooseFilter("note")}>我的整理 <b>{notes.filter((note) => note.sourceType !== "favorite").length}</b></button></div><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setSelectedIds(new Set()); }} placeholder="搜尋標題、內容、科目、標籤或來源…" aria-label="搜尋我的筆記" /></section>
    {!loading && filtered.length > 0 && <section className="notes-bulkbar"><label><input type="checkbox" checked={filtered.every((note) => selectedIds.has(note.id))} onChange={toggleAllFiltered} />全選目前結果（{filtered.length}）</label><span>已選 {selectedIds.size} 則</span><button type="button" disabled={!selectedIds.size || deleting} onClick={() => void removeSelected()}>{deleting ? "刪除中…" : "一鍵刪除已選"}</button>{message && <small>{message}</small>}</section>}
    {loading ? <div className="notes-empty">正在讀取我的筆記…</div> : visible.length ? <section className="standalone-note-list">{visible.map((note) => <article className={selectedIds.has(note.id) ? "selected" : ""} key={note.id} onClick={() => setDraft(note)}><label className="note-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(note.id)} onChange={() => toggleSelected(note.id)} aria-label={`選取「${note.title}」`} /><span>選取</span></label><div className="standalone-note-tags"><span>{note.sourceType === "favorite" ? "快速收藏" : "我的筆記"}</span><em>{note.subject}</em>{note.tags && <i>{note.tags}</i>}</div><h2>{note.title}</h2><p>{note.content}</p>{note.attachments?.[0] && <img src={note.attachments[0].url} alt="筆記附件" loading="lazy" />}{note.sourceLabel && <small>來源：{note.sourceLabel}</small>}<button type="button">查看／編輯</button></article>)}</section> : <div className="notes-empty"><b>{query ? "找不到符合條件的筆記" : "還沒有筆記"}</b><span>{query ? "可改用科目、爭點或來源名稱搜尋。" : "你可以在任何內容按「快速收藏」或「整理成筆記」，也能從這裡新增空白筆記。"}</span></div>}
    {filtered.length > pageSize && <nav className="notes-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一頁</button><span>第 {page}／{pages} 頁</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一頁</button></nav>}
    {draft && <div className="standalone-note-backdrop" onMouseDown={() => setDraft(null)}><section className="standalone-note-editor" role="dialog" aria-modal="true" aria-label={draft.id ? "編輯筆記" : "新增筆記"} onMouseDown={(event) => event.stopPropagation()}><header><div><span>{draft.sourceType === "favorite" ? "快速收藏" : "我的筆記"}</span><h2>{draft.id ? "查看與編輯" : "新增筆記"}</h2></div><button type="button" onClick={() => setDraft(null)}>×</button></header><label>標題<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><div className="standalone-note-fields"><label>科目<input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label><label>標籤<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="重要、待複習" /></label></div><label>筆記內容<textarea rows={13} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>{draft.sourceLabel && <p>來源：{draft.sourceLabel}</p>}{draft.attachments?.map((attachment) => <img src={attachment.url} alt="筆記附件" key={attachment.id} />)}{message && <small className="standalone-note-message">{message}</small>}<footer>{draft.id ? <button type="button" className="danger" onClick={() => void remove()}>刪除</button> : <span />}<div><button type="button" onClick={() => setDraft(null)}>取消</button><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存筆記"}</button></div></footer></section></div>}
  </main>;
}
