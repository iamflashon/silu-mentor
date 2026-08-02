"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Plan = { id: number; title: string; targetLabel: string; dailyMinutes: number };
type Task = { id: number; planId: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type Draft = { id?: number; date: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type StudyRecord = { id: number; recordDate: string; subject: string; title: string; activityType: string; plannedMinutes: number; actualMinutes: number; correct: boolean | null; reflection: string; weakness: string; nextStep: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };

const subjects = ["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法", "綜合"];

function monthValue(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
}

export default function StudyPlanPage() {
  const [month, setMonth] = useState(monthValue());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [notePage, setNotePage] = useState(1);
  const [noteQuery, setNoteQuery] = useState("");
  const [recordDraft, setRecordDraft] = useState({ subject: "刑法", title: "", actualMinutes: 60, weakness: "", nextStep: "" });
  const [activeTab, setActiveTab] = useState<"calendar" | "records" | "notes">("calendar");
  const [noteDraft, setNoteDraft] = useState<SavedNote | null>(null);

  async function load() {
    const response = await fetch(`/api/study-plan?month=${month}`);
    if (!response.ok) return;
    const result = await response.json() as { plans: Plan[]; tasks: Task[] };
    setPlans(result.plans ?? []);
    setTasks(result.tasks ?? []);
  }

  useEffect(() => { void load(); }, [month]);
  useEffect(() => { fetch("/api/learning-records").then(async (response) => { if (response.ok) setRecords(((await response.json()) as { records?: StudyRecord[] }).records ?? []); }); fetch("/api/notes").then(async (response) => { if (response.ok) setNotes(((await response.json()) as { notes?: SavedNote[] }).notes ?? []); }); }, []);

  const days = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const count = new Date(year, monthNumber, 0).getDate();
    const cells: Array<number | null> = Array(first.getDay()).fill(null);
    for (let day = 1; day <= count; day += 1) cells.push(day);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);

  function dateFor(day: number) { return `${month}-${String(day).padStart(2, "0")}`; }
  function openNew(day?: number) {
    setDraft({ date: day ? dateFor(day) : `${month}-01`, subject: "刑法", title: "", durationMinutes: 60, details: "", status: "pending" });
  }
  function openTask(task: Task) { setDraft({ id: task.id, date: task.taskDate, subject: task.subject, title: task.title, durationMinutes: task.durationMinutes, details: task.details, status: task.status }); }

  async function save() {
    if (!draft?.title.trim()) { setMessage("請輸入任務名稱"); return; }
    const response = await fetch("/api/study-plan", {
      method: draft.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: draft.id, planId: plans[0]?.id, ...draft }),
    });
    if (!response.ok) { const result = await response.json() as { error?: string }; setMessage(result.error ?? "儲存失敗"); return; }
    setDraft(null); setMessage(""); await load();
  }

  async function remove() {
    if (!draft?.id) return;
    await fetch(`/api/study-plan?taskId=${draft.id}`, { method: "DELETE" });
    setDraft(null); await load();
  }

  async function toggle(task: Task) {
    await fetch("/api/study-plan", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, status: task.status === "completed" ? "pending" : "completed" }) });
    await load();
  }

  function moveMonth(delta: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    setMonth(monthValue(new Date(year, monthNumber - 1 + delta, 1)));
  }

  const filteredNotes = notes.filter((note) => !noteQuery.trim() || `${note.title} ${note.content} ${note.tags} ${note.subject}`.toLowerCase().includes(noteQuery.trim().toLowerCase()));
  const visibleRecords = records.slice((recordPage - 1) * 10, recordPage * 10);
  const visibleNotes = filteredNotes.slice((notePage - 1) * 10, notePage * 10);

  async function addRecord() {
    if (!recordDraft.title.trim()) return;
    const response = await fetch("/api/learning-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...recordDraft, activityType: "手動補登" }) });
    if (!response.ok) return;
    const result = await response.json() as { record: StudyRecord }; setRecords((current) => [result.record, ...current]); setRecordDraft({ subject: "刑法", title: "", actualMinutes: 60, weakness: "", nextStep: "" }); setRecordPage(1);
  }

  async function saveNote() {
    if (!noteDraft?.content.trim()) return;
    const response = await fetch("/api/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(noteDraft) });
    if (!response.ok) return;
    setNotes((current) => current.map((note) => note.id === noteDraft.id ? { ...noteDraft, updatedAt: new Date().toISOString() } : note)); setNoteDraft(null);
  }

  async function removeNote() {
    if (!noteDraft || !window.confirm(`確定刪除「${noteDraft.title}」？`)) return;
    const response = await fetch(`/api/notes?id=${noteDraft.id}`, { method: "DELETE" });
    if (response.ok) { setNotes((current) => current.filter((note) => note.id !== noteDraft.id)); setNoteDraft(null); }
  }

  return <main className="plan-shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">律</span><span>司律導師</span></Link>
      <div className="top-actions"><Link href="/" className="back-link">返回對話</Link><Link href="/admin" className="admin-link">管理後台</Link></div>
    </header>
    <div className="plan-main">
      <div className="plan-header">
        <div><p>MY LEARNING CENTER</p><h1>我的學習專區</h1><span>{plans[0] ? `${plans[0].targetLabel} · 每日 ${plans[0].dailyMinutes} 分鐘` : "和司律導師聊完後，AI 會把任務寫到這裡"}</span></div>
        {activeTab === "calendar" && <button className="add-task" onClick={() => openNew()}>＋ 新增任務</button>}
      </div>
      <nav className="plan-tabs"><button className={activeTab === "calendar" ? "active" : ""} onClick={() => setActiveTab("calendar")}>行事曆</button><button className={activeTab === "records" ? "active" : ""} onClick={() => setActiveTab("records")}>學習紀錄 <span>{records.length}</span></button><button className={activeTab === "notes" ? "active" : ""} onClick={() => setActiveTab("notes")}>筆記收藏 <span>{notes.length}</span></button></nav>
      {activeTab === "calendar" && <><div className="calendar-toolbar"><button onClick={() => moveMonth(-1)}>‹</button><strong>{month.replace("-", " 年 ")} 月</strong><button onClick={() => moveMonth(1)}>›</button></div>
      <div className="calendar-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {days.map((day, index) => <div className={`calendar-day ${day ? "" : "blank"}`} key={`${day}-${index}`} onDoubleClick={() => day && openNew(day)}>{day && <><span className="day-number">{day}</span><div className="day-tasks">{tasks.filter((task) => task.taskDate === dateFor(day)).map((task) => <div className={`calendar-task ${task.status === "completed" ? "done" : ""}`} key={task.id} onClick={() => openTask(task)}><button onClick={(event) => { event.stopPropagation(); void toggle(task); }} aria-label="切換完成狀態">{task.status === "completed" ? "✓" : ""}</button><div><strong>{task.subject}</strong><span>{task.title}</span><small>{task.durationMinutes} 分鐘</small></div></div>)}</div><button className="day-add" onClick={() => openNew(day)}>＋</button></>}</div>)}
      </div></>}
      {activeTab === "records" && <section className="learning-hub tab-hub" id="records">
        <div className="hub-heading"><div><p>LEARNING HISTORY</p><h2>學習紀錄</h2><span>完成讀書任務與一試練題後會自動寫入，也保留實際時間、弱點與下次接續點。</span></div><strong>{records.length} 筆</strong></div>
        <div className="record-entry"><select value={recordDraft.subject} onChange={(event) => setRecordDraft({ ...recordDraft, subject: event.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select><input value={recordDraft.title} onChange={(event) => setRecordDraft({ ...recordDraft, title: event.target.value })} placeholder="今天實際學了什麼？" /><input type="number" min="0" max="720" value={recordDraft.actualMinutes} onChange={(event) => setRecordDraft({ ...recordDraft, actualMinutes: Number(event.target.value) })} aria-label="實際分鐘" /><input value={recordDraft.weakness} onChange={(event) => setRecordDraft({ ...recordDraft, weakness: event.target.value })} placeholder="發現的弱點（可不填）" /><input value={recordDraft.nextStep} onChange={(event) => setRecordDraft({ ...recordDraft, nextStep: event.target.value })} placeholder="下次從哪裡接續？" /><button onClick={addRecord}>補登紀錄</button></div>
        {visibleRecords.length ? <div className="record-list">{visibleRecords.map((record) => <article key={record.id}><time>{record.recordDate}</time><div><strong>{record.subject} · {record.title}</strong><span>{record.activityType} · 實際 {record.actualMinutes} 分鐘{record.correct === null ? "" : record.correct ? " · 答對" : " · 待補強"}</span>{record.weakness && <small>弱點：{record.weakness}</small>}{record.nextStep && <small>下次接續：{record.nextStep}</small>}</div></article>)}</div> : <div className="hub-empty">完成第一項任務、練完第一題或手動補登後，紀錄會出現在這裡。</div>}
        {records.length > 10 && <nav className="document-pagination"><button disabled={recordPage === 1} onClick={() => setRecordPage((page) => page - 1)}>上一頁</button><span>第 {recordPage} / {Math.ceil(records.length / 10)} 頁</span><button disabled={recordPage >= Math.ceil(records.length / 10)} onClick={() => setRecordPage((page) => page + 1)}>下一頁</button></nav>}
      </section>}
      {activeTab === "notes" && <section className="learning-hub tab-hub" id="notes">
        <div className="hub-heading"><div><p>MY COLLECTION</p><h2>筆記收藏</h2><span>從導師對話一鍵收藏，保留教材來源並可依科目、標籤與內容搜尋。</span></div><strong>{notes.length} 則</strong></div>
        <input className="note-search" value={noteQuery} onChange={(event) => { setNoteQuery(event.target.value); setNotePage(1); }} placeholder="搜尋筆記、科目或標籤…" />
        {visibleNotes.length ? <div className="note-list">{visibleNotes.map((note) => <article key={note.id} onClick={() => setNoteDraft(note)}><div><span>{note.subject}</span>{note.tags && <em>{note.tags}</em>}<button>編輯</button></div><strong>{note.title}</strong><p>{note.content}</p>{note.sourceLabel && <small>教材來源：{note.sourceLabel}</small>}</article>)}</div> : <div className="hub-empty">尚未收藏筆記。回到對話後，按下 AI 回答下方的「收藏筆記」即可加入。</div>}
        {filteredNotes.length > 10 && <nav className="document-pagination"><button disabled={notePage === 1} onClick={() => setNotePage((page) => page - 1)}>上一頁</button><span>第 {notePage} / {Math.ceil(filteredNotes.length / 10)} 頁</span><button disabled={notePage >= Math.ceil(filteredNotes.length / 10)} onClick={() => setNotePage((page) => page + 1)}>下一頁</button></nav>}
      </section>}
    </div>
    {draft && <div className="editor-backdrop" onClick={() => setDraft(null)}><section className="task-editor" onClick={(event) => event.stopPropagation()}><div className="editor-title"><h2>{draft.id ? "編輯讀書任務" : "新增讀書任務"}</h2><button onClick={() => setDraft(null)}>×</button></div><label className="field">日期<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label><label className="field">科目<select value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">任務名稱<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：不作為犯基本觀念" /></label><label className="field">預計時間（分鐘）<input type="number" min="10" max="480" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label><label className="field">學習內容<textarea value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={4} /></label><label className="complete-check"><input type="checkbox" checked={draft.status === "completed"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "completed" : "pending" })} />已完成</label>{message && <p className="editor-message">{message}</p>}<div className="editor-actions">{draft.id && <button className="delete-task" onClick={remove}>刪除</button>}<button className="primary-btn" onClick={save}>儲存任務</button></div></section></div>}
    {noteDraft && <div className="editor-backdrop" onClick={() => setNoteDraft(null)}><section className="task-editor note-editor" onClick={(event) => event.stopPropagation()}><div className="editor-title"><h2>編輯筆記</h2><button onClick={() => setNoteDraft(null)}>×</button></div><label className="field">標題<input value={noteDraft.title} onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} /></label><label className="field">科目<select value={noteDraft.subject} onChange={(e) => setNoteDraft({ ...noteDraft, subject: e.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">標籤<input value={noteDraft.tags} onChange={(e) => setNoteDraft({ ...noteDraft, tags: e.target.value })} placeholder="重要、待複習…" /></label><label className="field">筆記內容<textarea value={noteDraft.content} onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })} rows={9} /></label>{noteDraft.sourceLabel && <p className="note-source-readonly">教材來源：{noteDraft.sourceLabel}</p>}<div className="editor-actions"><button className="delete-task" onClick={removeNote}>刪除筆記</button><button className="primary-btn" onClick={saveNote}>儲存筆記</button></div></section></div>}
  </main>;
}
