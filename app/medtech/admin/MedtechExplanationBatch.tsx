"use client";
import { useEffect, useMemo, useState } from "react";
import "./medtech-explanation-batch.css";

type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; explanation: string; correctAnswer: string | null; status: string };
function plain(value: string) { return String(value ?? "").replace(/<br\s*\/?>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim(); }

export default function MedtechExplanationBatch() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  async function load() {
    setLoading(true);
    const all: Question[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const response = await fetch(`/api/medtech/admin/questions?page=${page}&limit=100&order=source`, { cache: "no-store" });
      const data = await response.json() as { items?: Question[]; total?: number; error?: string };
      if (!response.ok) { setNotice(data.error ?? "題庫讀取失敗"); break; }
      all.push(...(data.items ?? []));
      if (all.length >= Number(data.total ?? all.length) || !(data.items ?? []).length) break;
    }
    setQuestions(all); setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const pending = questions.filter((question) => !plain(question.explanation));
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-Hant");
    return keyword ? questions.filter((item) => `${item.year} ${item.subject} ${item.questionNumber} ${plain(item.stem)}`.toLocaleLowerCase("zh-Hant").includes(keyword)) : questions;
  }, [questions, search]);
  async function generate(question: Question) {
    const response = await fetch("/api/medtech/admin/questions/explanation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: question.id }) });
    const data = await response.json() as { item?: Question; error?: string };
    if (!response.ok || !data.item) throw new Error(data.error ?? "產生失敗");
    setQuestions((list) => list.map((item) => item.id === question.id ? data.item! : item));
  }
  async function generateAll() {
    if (!pending.length) { setNotice("目前每一題都已有完整解析。"); return; }
    if (!confirm(`目前有 ${pending.length} 題缺少完整解析。AI 將逐題產生解析文，完成後仍需老師抽查。確定開始？`)) return;
    setBusy(true); let success = 0; let failed = 0;
    for (const question of pending) {
      setNotice(`正在產生完整解析：${success + failed + 1}/${pending.length}（第 ${question.questionNumber || question.id} 題）`);
      try { await generate(question); success += 1; } catch { failed += 1; }
    }
    setBusy(false); setNotice(`完成：成功 ${success} 題${failed ? `，失敗 ${failed} 題` : ""}。請抽查後再下載 TXT／匯入語音。`);
  }
  return <>
    <section className="medtech-admin-panel medtech-explanation-hero"><div><span>醫檢師 · AI 解析整理</span><h2>完整解析欄與語音解析文</h2><p>缺少原稿解析的題目，可由 AI 先產生可直接錄音的口語解析；老師可在題目工作台逐題修正，確認後再下載 TXT ZIP。</p></div><div className="explanation-count"><b>{pending.length}</b><small>題待補齊</small></div></section>
    <section className="medtech-admin-panel"><div className="explanation-tools"><div><h2>一鍵補齊未完成解析</h2><p>每題會獨立記錄模型與使用量；不會覆蓋已有解析。</p></div><button disabled={busy || loading || !pending.length} onClick={() => void generateAll()}>{busy ? "逐題產生中…" : pending.length ? `AI補齊 ${pending.length} 題` : "全部已有解析"}</button></div>{notice && <p className="medtech-admin-notice">{notice}</p>}<div className="explanation-search-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋年份、科目、題號或題幹" /><span>共 {questions.length} 題 · 待補 {pending.length} 題</span></div>{loading ? <p>正在讀取醫檢題庫…</p> : <div className="explanation-question-list">{visible.map((question) => <article key={question.id}><div><b>{question.subject} · {question.year} · 第 {question.questionNumber} 題</b><small>q{question.id} · {plain(question.stem).slice(0, 150)}</small></div><span className={plain(question.explanation) ? "ready" : "pending"}>{plain(question.explanation) ? "已有解析" : "待補齊"}</span><button disabled={busy || Boolean(!question.correctAnswer) || Boolean(plain(question.explanation))} onClick={() => { setBusy(true); setNotice(`正在產生第 ${question.questionNumber || question.id} 題…`); void generate(question).then(() => setNotice(`第 ${question.questionNumber || question.id} 題已產生，請開啟工作台核對。`)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "產生失敗")).finally(() => setBusy(false)); }}>{!question.correctAnswer ? "先補答案" : plain(question.explanation) ? "已完成" : "產生解析"}</button></article>)}{!visible.length && <p>找不到符合條件的題目。</p>}</div>}</section>
  </>;
}
