"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Plan = { id: number; title: string; targetLabel: string; dailyMinutes: number };
type Task = { id: number; planId: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type Draft = { id?: number; date: string; subject: string; title: string; durationMinutes: number; details: string; status: string };

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

  async function load() {
    const response = await fetch(`/api/study-plan?month=${month}`);
    if (!response.ok) return;
    const result = await response.json() as { plans: Plan[]; tasks: Task[] };
    setPlans(result.plans ?? []);
    setTasks(result.tasks ?? []);
  }

  useEffect(() => { void load(); }, [month]);

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

  return <main className="plan-shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">律</span><span>司律導師</span></Link>
      <div className="top-actions"><Link href="/" className="back-link">返回對話</Link><Link href="/admin" className="admin-link">管理後台</Link></div>
    </header>
    <div className="plan-main">
      <div className="plan-header">
        <div><p>AI STUDY PLAN</p><h1>我的讀書計畫</h1><span>{plans[0] ? `${plans[0].targetLabel} · 每日 ${plans[0].dailyMinutes} 分鐘` : "和司律導師聊完後，AI 會把任務寫到這裡"}</span></div>
        <button className="add-task" onClick={() => openNew()}>＋ 新增任務</button>
      </div>
      <div className="calendar-toolbar"><button onClick={() => moveMonth(-1)}>‹</button><strong>{month.replace("-", " 年 ")} 月</strong><button onClick={() => moveMonth(1)}>›</button></div>
      <div className="calendar-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {days.map((day, index) => <div className={`calendar-day ${day ? "" : "blank"}`} key={`${day}-${index}`} onDoubleClick={() => day && openNew(day)}>{day && <><span className="day-number">{day}</span><div className="day-tasks">{tasks.filter((task) => task.taskDate === dateFor(day)).map((task) => <div className={`calendar-task ${task.status === "completed" ? "done" : ""}`} key={task.id} onClick={() => openTask(task)}><button onClick={(event) => { event.stopPropagation(); void toggle(task); }} aria-label="切換完成狀態">{task.status === "completed" ? "✓" : ""}</button><div><strong>{task.subject}</strong><span>{task.title}</span><small>{task.durationMinutes} 分鐘</small></div></div>)}</div><button className="day-add" onClick={() => openNew(day)}>＋</button></>}</div>)}
      </div>
    </div>
    {draft && <div className="editor-backdrop" onClick={() => setDraft(null)}><section className="task-editor" onClick={(event) => event.stopPropagation()}><div className="editor-title"><h2>{draft.id ? "編輯讀書任務" : "新增讀書任務"}</h2><button onClick={() => setDraft(null)}>×</button></div><label className="field">日期<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label><label className="field">科目<select value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">任務名稱<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：不作為犯基本觀念" /></label><label className="field">預計時間（分鐘）<input type="number" min="10" max="480" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label><label className="field">學習內容<textarea value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={4} /></label><label className="complete-check"><input type="checkbox" checked={draft.status === "completed"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "completed" : "pending" })} />已完成</label>{message && <p className="editor-message">{message}</p>}<div className="editor-actions">{draft.id && <button className="delete-task" onClick={remove}>刪除</button>}<button className="primary-btn" onClick={save}>儲存任務</button></div></section></div>}
  </main>;
}
