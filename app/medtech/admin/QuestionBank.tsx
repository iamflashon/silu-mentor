"use client";

import "./question-bank.css";
import { useEffect, useState } from "react";

type Category = "medtech" | "accounting";
type Question = {
  id: number;
  examType?: string;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  explanation: string;
  completeExplanation?: string;
  aiCompleteExplanation?: string;
  teacherCompleteExplanation?: string;
  voiceScript?: string;
  teacherAnswer?: string;
  answerSource: string;
  status: string;
};

const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export default function QuestionBank({ category = "medtech" }: { category?: Category }) {
  const accounting = category === "accounting";
  const label = accounting ? "中會" : "醫檢";
  const endpoint = accounting ? "/api/accounting/admin/questions" : "/api/medtech/admin/questions";
  const workbench = accounting ? "/accounting/admin/question-workbench" : "/medtech/admin/question-workbench";
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [years, setYears] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const limit = 30;

  async function load(nextPage = page) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(nextPage), limit: String(limit) });
    if (query) params.set("query", query);
    if (year) params.set("year", year);
    if (subject) params.set("subject", subject);
    if (status) params.set("status", status);
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    const data = await response.json() as { items?: Question[]; total?: number; draftTotal?: number; years?: string[]; subjects?: string[]; error?: string };
    if (response.ok) {
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setDraftTotal(data.draftTotal ?? 0);
      setYears(data.years ?? []);
      setSubjects(data.subjects ?? []);
      setPage(nextPage);
    } else setMessage(data.error ?? "題庫讀取失敗");
    setLoading(false);
  }

  useEffect(() => { const initial = window.setTimeout(() => void load(1), 0); return () => window.clearTimeout(initial); }, []);

  async function toggle(item: Question) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, status: item.status === "published" ? "disabled" : "published" }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      setMessage(data.error ?? "題目狀態更新失敗");
      return;
    }
    await load();
  }

  async function remove(item: Question) {
    if (!confirm(`確定刪除第 ${item.questionNumber} 題？此操作無法復原。`)) return;
    await fetch(endpoint, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    setMessage("題目已刪除。");
    await load(Math.min(page, Math.max(1, Math.ceil((total - 1) / limit))));
  }

  const pages = Math.max(1, Math.ceil(total / limit));
  return <>
    <section className="medtech-admin-panel question-tools">
      <div className="medtech-admin-heading"><div><h2>{label}題庫總覽</h2><p>共 {total.toLocaleString()} 題，只顯示{label}類科。{draftTotal ? ` 另有 ${draftTotal.toLocaleString()} 題草稿尚未發布；請回文件題庫逐份發布。` : ""}</p></div><div className="question-tools-actions"><button className="refresh" onClick={() => void load(1)}>重新整理</button></div></div>
      <div className="question-filters"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === "Enter" && void load(1)} placeholder="搜尋題幹、題號或解析" /><select value={year} onChange={event => setYear(event.target.value)}><option value="">全部年份</option>{years.map(value => <option key={value}>{value}</option>)}</select><select value={subject} onChange={event => setSubject(event.target.value)}><option value="">全部科目</option>{subjects.map(value => <option key={value}>{value}</option>)}</select><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部狀態</option><option value="published">已啟用</option><option value="disabled">已停用</option><option value="draft">草稿</option></select><button onClick={() => void load(1)}>搜尋</button></div>
      {message && <p className="medtech-admin-notice">{message}</p>}
    </section>
    <section className="medtech-admin-panel"><div className="medtech-question-admin-list">{loading ? <p>正在讀取題庫…</p> : items.map(item => <article key={item.id}>
      <header><div><span>{item.year} 年 · {item.subject} · 第 {item.questionNumber} 題</span><b className={item.status}>{item.status === "published" ? "已啟用" : item.status === "disabled" ? "已停用" : "草稿"}</b></div><h3>{plain(item.stem)}</h3></header>
      <details><summary>查看選項、答案與解析</summary>{item.examType !== "essay" && <div className="admin-question-options">{Object.entries(item.options).map(([key, value]) => <div className={key === item.correctAnswer ? "correct" : ""} key={key}><b>{key}</b><span>{plain(value)}</span></div>)}</div>}<div className="admin-question-explanation"><b>{item.examType === "essay" ? "老師解答" : `正確答案：${item.correctAnswer || "未設定"}`}</b>{item.examType === "essay" ? <p>{plain(item.teacherAnswer || item.explanation) || "尚無老師解答"}</p> : <><strong>解析（題目原有簡要解析）</strong><p>{plain(item.explanation) || "題目原稿未附簡要解析"}</p><strong>老師完整解析（老師版）</strong><p>{plain(item.teacherCompleteExplanation || "") || "尚未補充老師完整解析"}</p><strong>語音解析腳本</strong><p>{plain(item.voiceScript || "") || "尚未產生語音解析腳本"}</p></>}<small>來源：{item.answerSource || "未標示"}</small></div></details>
      <footer><button onClick={() => { window.location.href = `${workbench}?id=${item.id}`; }}>開啟題目工作台</button><button onClick={() => void toggle(item)}>{item.status === "published" ? "停用" : "啟用"}</button><button className="danger" onClick={() => void remove(item)}>刪除</button></footer>
    </article>)}{!loading && !items.length && <p>沒有符合條件的題目。</p>}</div><div className="question-pagination"><button disabled={page <= 1} onClick={() => void load(page - 1)}>上一頁</button><span>第 {page}／{pages} 頁</span><button disabled={page >= pages} onClick={() => void load(page + 1)}>下一頁</button></div></section>
  </>;
}
