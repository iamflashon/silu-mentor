"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "../listening-player";
import { PracticeLab } from "./practice-lab";
import { LegalSearch } from "./legal-search";

type Plan = { id: number; title: string; targetLabel: string; dailyMinutes: number };
type Task = { id: number; planId: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type Draft = { id?: number; date: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type StudyRecord = { id: number; recordDate: string; subject: string; title: string; activityType: string; plannedMinutes: number; actualMinutes: number; correct: boolean | null; reflection: string; weakness: string; nextStep: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };
type Dashboard = { today: string; todayProgress: { completed: number; total: number; delayed: number; records: number; correct: number; answered: number }; priorities: Array<{ topic: string; count: number; reason: string }>; hasRecords: boolean; encouragement: string };
type HomeFeed = { magazine: { id: number; title: string; sourceUrl: string; description?: string; articles?: Array<{ id: number; title: string; summary: string; reviewStatus: string; sequence: number }> } | null; listening: ListeningFeed | null; focusMusicUrl?: string };

const subjects = ["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法", "綜合"];
const fallbackWeeklyFocus = ["罪刑法定原則", "犯罪成立要件", "行為與不作為犯、保證人地位", "因果關係", "客觀歸責", "故意、過失與事實錯誤", "正當防衛與緊急避難"];

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
  const [activeTab, setActiveTab] = useState<"calendar" | "overview" | "practice" | "laws" | "listening" | "magazine" | "records" | "notes">("calendar");
  const [practiceType, setPracticeType] = useState<"mcq" | "essay">("mcq");
  const [noteDraft, setNoteDraft] = useState<SavedNote | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);

  async function load() {
    const response = await fetch(`/api/study-plan?month=${month}`);
    if (!response.ok) return;
    const result = await response.json() as { plans: Plan[]; tasks: Task[] };
    setPlans(result.plans ?? []);
    setTasks(result.tasks ?? []);
  }

  useEffect(() => { void load(); }, [month]);
  useEffect(() => {
    fetch("/api/learning-records").then(async (response) => { if (response.ok) setRecords(((await response.json()) as { records?: StudyRecord[] }).records ?? []); });
    fetch("/api/notes").then(async (response) => { if (response.ok) setNotes(((await response.json()) as { notes?: SavedNote[] }).notes ?? []); });
    fetch("/api/dashboard").then(async (response) => { if (response.ok) setDashboard((await response.json()) as Dashboard); });
    fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed((await response.json()) as HomeFeed); });
  }, []);

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
  const today = dashboard?.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const todayTasks = tasks.filter((task) => task.taskDate === today);
  const todayProgress = dashboard?.todayProgress ?? { completed: todayTasks.filter((task) => task.status === "completed").length, total: todayTasks.length, delayed: 0, records: 0, correct: 0, answered: 0 };
  const weekStart = new Date(`${today}T00:00:00+08:00`);
  const weeklyFocus = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const dateText = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
    const task = tasks.find((item) => item.taskDate === dateText);
    return { date: dateText.slice(5).replace("-", "/"), dateText, day: date.getDate(), weekday: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()], title: task?.title || fallbackWeeklyFocus[index], subject: task?.subject || "刑法總則", hasTask: Boolean(task) };
  });

  function youtubeEmbedUrl(value: string) {
    try {
      const url = new URL(value.trim());
      let id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? "");
      id = id.split(/[?&]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1&enablejsapi=1` : "";
    } catch { return ""; }
  }

  function youtubeWatchUrl(value: string) {
    try {
      const url = new URL(value.trim());
      const id = (url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? "")).split(/[?&]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : "";
    } catch { return ""; }
  }

  function requestYoutubePlay(root: Element | null) { const iframe = root?.querySelector<HTMLIFrameElement>("iframe"); iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "https://www.youtube.com"); }

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
      <Link href="/" className="brand"><span className="brand-mark">律</span><span>司律備考</span></Link>
      <div className="top-actions"><Link href="/" className="back-link">返回對話</Link><Link href="/admin" className="admin-link">管理後台</Link></div>
    </header>
    <div className="plan-main">
      <div className="plan-header">
        <div><p>MY LEARNING CENTER</p><h1>學習專區</h1><span>{plans[0] ? `${plans[0].targetLabel} · 每日 ${plans[0].dailyMinutes} 分鐘` : "和司律備考聊完後，AI 會把任務寫到這裡"}</span></div>
        {activeTab === "calendar" && <button className="add-task" onClick={() => openNew()}>＋ 新增任務</button>}
      </div>
      <nav className="plan-tabs"><button className={activeTab === "calendar" ? "active" : ""} onClick={() => setActiveTab("calendar")}>行事曆</button><button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>作戰總覽</button><button className={activeTab === "practice" ? "active" : ""} onClick={() => setActiveTab("practice")}>主動刷題</button><button className={activeTab === "laws" ? "active" : ""} onClick={() => setActiveTab("laws")}>法規搜尋</button><button className={activeTab === "listening" ? "active" : ""} onClick={() => setActiveTab("listening")}>聽解題</button><button className={activeTab === "magazine" ? "active" : ""} onClick={() => setActiveTab("magazine")}>法教專區</button><button className={activeTab === "records" ? "active" : ""} onClick={() => setActiveTab("records")}>學習紀錄 <span>{records.length}</span></button><button className={activeTab === "notes" ? "active" : ""} onClick={() => setActiveTab("notes")}>筆記收藏 <span>{notes.length}</span></button></nav>
      {activeTab === "overview" && <>
      <section className="exam-gateway" aria-label="一試與二試主動練習入口"><article><div><span>第一試 · 選擇題</span><h2>一試主動刷題</h2><p>從已審核的一試題庫開始作答，留下答對率與待補強觀念。</p></div><button onClick={() => { setPracticeType("mcq"); setActiveTab("practice"); }}>開始一試</button></article><article><div><span>第二試 · 申論題</span><h2>二試主動寫題</h2><p>先自己審題、列爭點與答題骨架，再由 AI 引導修正。</p></div><button onClick={() => { setPracticeType("essay"); setActiveTab("practice"); }}>開始二試</button></article></section>
      <section className="learning-overview" aria-label="學習專區摘要">
        <article className="overview-card battle-card"><div className="overview-card-heading"><strong>今日戰況</strong><span>{today}</span></div><b>{todayProgress.completed} <small>/ {todayProgress.total} 項完成</small></b><div className="overview-progress"><i style={{ width: `${todayProgress.total ? Math.round(todayProgress.completed / todayProgress.total * 100) : 0}%` }} /></div><p>{todayProgress.answered ? `今日作答 ${todayProgress.answered} 題，答對 ${todayProgress.correct} 題。` : todayProgress.delayed ? `有 ${todayProgress.delayed} 項延誤，先完成今天第一項。` : dashboard?.encouragement || "先完成今天第一項，節奏就會開始。"}</p></article>
        <article className="overview-card priority-card"><div className="overview-card-heading"><strong>優先補強</strong><span>依學習紀錄</span></div>{dashboard?.priorities.length ? <ul>{dashboard.priorities.map((item) => <li key={item.topic}><b>{item.topic}</b><small>{item.reason}</small></li>)}</ul> : <p>目前尚無學習紀錄，因此今日優先補強會先以「罪刑法定原則：法律保留與禁止類推適用」為主。</p>}</article>
        <article className="overview-card mini-calendar-card"><div className="overview-card-heading"><strong>今日小型行事曆</strong><span>{today.replace("-", "年 ").replace("-", "月 ")}日</span></div><div className="mini-week-grid">{weeklyFocus.map((item) => <div className={item.dateText === today ? "today" : ""} key={item.dateText}><time>{item.weekday}</time><b>{item.day}</b>{item.hasTask && <i />}</div>)}</div>{todayTasks.length ? todayTasks.slice(0, 2).map((task) => <div className="mini-task" key={task.id}><b>{task.subject}</b><span>{task.title}</span><small>預計學習：{task.durationMinutes}分鐘 · {task.status === "completed" ? "已完成" : "待開始"}</small></div>) : <div className="mini-task"><b>刑法總則</b><span>罪刑法定原則：法律保留與禁止類推適用</span><small>預計學習：120分鐘 · 待開始</small></div>}</article>
        <article className="overview-card weekly-card"><div className="overview-card-heading"><strong>本週 AI 重點課程</strong><span>每日一段</span></div><div className="weekly-focus-list">{weeklyFocus.map((item) => <div key={item.date}><time>{item.date}</time><span>{item.title}</span></div>)}</div></article>
      </section>
      </>}
      {activeTab === "listening" && <section className="learning-single-column" aria-label="聽解題專區"><article className="column-card listening-feature"><div className="column-kicker">LISTENING SOLUTION</div><div className="column-heading"><div><h2>聽解題</h2><span>{homeFeed?.listening ? `${homeFeed.listening.year} · ${homeFeed.listening.subject}` : "把解題變成可以反覆聽的學習段落"}</span></div><i>{homeFeed?.listening ? "▶" : "聽"}</i></div>{homeFeed?.listening ? <><p>先聽老師如何抓爭點，再留下自己的答題接續點。</p><ListeningPlayer item={homeFeed.listening} /></> : <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>}</article></section>}
      {activeTab === "magazine" && <section className="learning-single-column" aria-label="法教專區"><article className="column-card law-column"><div className="column-kicker">LAW CLASSROOM</div><div className="column-heading"><div><h2>法教專區</h2><span>從最新法學教室內容找考試切入點</span></div><i>法</i></div>{homeFeed?.magazine ? <><strong>{homeFeed.magazine.title}</strong><div className="magazine-article-list">{(homeFeed.magazine.articles ?? []).map((article) => <div className="magazine-article-row" key={article.id}><span>{article.title}</span><small>{article.summary || "已建立試讀分析"}</small></div>)}</div><a href={homeFeed.magazine.sourceUrl} target="_blank" rel="noreferrer">查看法學教室來源 →</a></> : <p className="column-empty">後台匯入並發布法學教室試讀內容後，最新專區會出現在這裡。</p>}</article></section>}
      {activeTab === "calendar" && <><div className="calendar-toolbar"><button onClick={() => moveMonth(-1)}>‹</button><strong>{month.replace("-", " 年 ")} 月</strong><button onClick={() => moveMonth(1)}>›</button></div>
      <div className="calendar-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {days.map((day, index) => <div className={`calendar-day ${day ? "" : "blank"}`} key={`${day}-${index}`} onDoubleClick={() => day && openNew(day)}>{day && <><span className="day-number">{day}</span><div className="day-tasks">{tasks.filter((task) => task.taskDate === dateFor(day)).map((task) => <div className={`calendar-task ${task.status === "completed" ? "done" : ""}`} key={task.id} onClick={() => openTask(task)}><button onClick={(event) => { event.stopPropagation(); void toggle(task); }} aria-label="切換完成狀態">{task.status === "completed" ? "✓" : ""}</button><div><strong>{task.subject}</strong><span>{task.title}</span><small>{task.durationMinutes} 分鐘</small></div></div>)}</div><button className="day-add" onClick={() => openNew(day)}>＋</button></>}</div>)}
      </div>
      </>}
      {activeTab === "practice" && <PracticeLab initialType={practiceType} />}
      {activeTab === "laws" && <LegalSearch />}
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
