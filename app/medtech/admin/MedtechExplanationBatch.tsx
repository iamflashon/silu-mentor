"use client";
import { useEffect, useMemo, useState } from "react";
import "./medtech-explanation-batch.css";

type Question = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  explanation: string;
  completeExplanation: string;
  correctAnswer: string | null;
  simulatedAnswer: string;
  simulatedExplanation: string;
  simulatedCompleteExplanation: string;
  simulatedSource: string;
  simulatedAnswerStatus: string;
  simulatedTeacherNote: string;
  answerStatus: string;
  status: string;
  topic?: string;
  isSimulation?: boolean;
  aiAccuracy?: "correct" | "incorrect" | "pending";
};

function plain(value: string) { return String(value ?? "").replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim(); }

export default function MedtechExplanationBatch() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("全部");
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);

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

  const simulated = questions.filter((question) => question.isSimulation);
  const simulationPending = simulated.filter((question) => !plain(question.simulatedAnswer) || !plain(question.simulatedExplanation) || !plain(question.simulatedCompleteExplanation));
  const simulationReviewed = simulated.filter((question) => question.simulatedAnswer && question.correctAnswer);
  const simulationCorrect = simulationReviewed.filter((question) => question.simulatedAnswer === question.correctAnswer).length;
  const accuracy = simulationReviewed.length ? `${Math.round(simulationCorrect / simulationReviewed.length * 100)}%` : "—";
  const pendingComplete = questions.filter((question) => !plain(question.completeExplanation));
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-Hant");
    return questions.filter((item) => {
      const matchesKeyword = !keyword || `${item.year} ${item.subject} ${item.questionNumber} ${item.topic ?? ""} ${plain(item.stem)}`.toLocaleLowerCase("zh-Hant").includes(keyword);
      const matchesTopic = topicFilter === "全部" || (item.topic ?? "其他") === topicFilter;
      return matchesKeyword && matchesTopic;
    });
  }, [questions, search, topicFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, topicFilter, pageSize]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function generate(question: Question, simulation = false) {
    const response = await fetch(simulation ? "/api/medtech/admin/questions/simulation" : "/api/medtech/admin/questions/explanation", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: question.id }),
    });
    const data = await response.json() as { item?: Question; error?: string };
    if (!response.ok || !data.item) throw new Error(data.error ?? "產生失敗");
    setQuestions((list) => list.map((item) => item.id === question.id ? { ...item, ...data.item } : item));
  }

  async function review(question: Question, answer: string) {
    if (!/^[A-D]$/.test(answer)) return;
    const response = await fetch("/api/medtech/admin/questions/simulation/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: question.id, correctAnswer: answer }),
    });
    const data = await response.json() as { item?: Question; error?: string; aiAccuracy?: string };
    if (!response.ok || !data.item) { setNotice(data.error ?? "老師答案儲存失敗"); return; }
    setQuestions((list) => list.map((item) => item.id === question.id ? { ...item, ...data.item, aiAccuracy: data.aiAccuracy === "ai_correct" ? "correct" : data.aiAccuracy === "ai_incorrect" ? "incorrect" : "pending" } : item));
    setNotice(`第 ${question.questionNumber || question.id} 題已完成老師批改。`);
  }

  async function generateSimulationAll() {
    if (!simulationPending.length) { setNotice("目前每一題擬真題都已有模擬答案與解析。"); return; }
    if (!confirm(`目前有 ${simulationPending.length} 題擬真題缺少模擬答案或解析。AI 將逐題產生，完成後請老師批改答案。確定開始？`)) return;
    setBusy(true); let success = 0; let failed = 0;
    for (const question of simulationPending) {
      setNotice(`正在產生擬真答案與解析：${success + failed + 1}/${simulationPending.length}（第 ${question.questionNumber || question.id} 題）`);
      try { await generate(question, true); success += 1; } catch { failed += 1; }
    }
    setBusy(false); setNotice(`擬真題完成：成功 ${success} 題${failed ? `，失敗 ${failed} 題` : ""}。請老師逐題批改以計算 AI 答對率。`);
  }

  async function generateAll() {
    if (!pendingComplete.length) { setNotice("目前每一題都已有正式完整解析。"); return; }
    if (!confirm(`目前有 ${pendingComplete.length} 題缺少正式完整解析。AI 將逐題產生，完成後仍需老師抽查。確定開始？`)) return;
    setBusy(true); let success = 0; let failed = 0;
    for (const question of pendingComplete) {
      setNotice(`正在產生正式完整解析：${success + failed + 1}/${pendingComplete.length}（第 ${question.questionNumber || question.id} 題）`);
      try { await generate(question); success += 1; } catch { failed += 1; }
    }
    setBusy(false); setNotice(`完成：成功 ${success} 題${failed ? `，失敗 ${failed} 題` : ""}。請抽查後再下載 TXT／匯入語音。`);
  }

  return <>
    <section className="medtech-admin-panel medtech-explanation-hero"><div><span>醫檢師 · 擬真題 AI 後台</span><h2>模擬答案、模擬解析與完整解析</h2><p>擬真題先由 AI 獨立作答與解析；老師批改後才成為正式答案，不會覆蓋題目原有的簡要解析。</p></div><div className="explanation-count"><b>{simulationPending.length}</b><small>題待 AI 擬答</small></div></section>
    <section className="medtech-admin-panel simulated-answer-panel"><div className="explanation-tools"><div><h2>一鍵補齊擬真答案與解析</h2><p>AI 會產生模擬答案、模擬解析、完整解析及依據註記，全部標記為「待老師批改」。</p></div><button disabled={busy || loading || !simulationPending.length} onClick={() => void generateSimulationAll()}>{busy ? "逐題產生中…" : simulationPending.length ? `AI補齊擬真題 ${simulationPending.length} 題` : "擬真題已完成 AI 擬答"}</button></div><div className="simulation-accuracy-summary"><span>擬真題總數 <b>{simulated.length}</b></span><span>老師已批改 <b>{simulationReviewed.length}</b></span><span>AI 答對率 <b>{accuracy}</b></span></div></section>
    <section className="medtech-admin-panel"><div className="explanation-tools"><div><h2>一鍵補齊正式完整解析</h2><p>只寫入獨立的「完整解析（老師／語音文本）」欄，不會改動題目原有簡要解析。</p></div><button disabled={busy || loading || !pendingComplete.length} onClick={() => void generateAll()}>{busy ? "逐題產生中…" : pendingComplete.length ? `AI補齊正式解析 ${pendingComplete.length} 題` : "全部已有正式完整解析"}</button></div>{notice && <p className="medtech-admin-notice">{notice}</p>}<div className="explanation-search-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋年份、科目、題號或題幹" /><select aria-label="依題庫分類篩選" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>{["全部", "臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題", "其他"].map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select><label className="page-size-control">每頁<select aria-label="每頁顯示題數" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[10, 30, 50, 100].map((size) => <option key={size} value={size}>{size} 題</option>)}</select></label><span>顯示 {filtered.length} 題 · 第 {page}/{pageCount} 頁 · 擬真題 {simulated.length} 題 · 待補正式解析 {pendingComplete.length} 題</span></div>{loading ? <p>正在讀取醫檢題庫…</p> : <><div className="explanation-question-list">{pageItems.map((question) => <article key={question.id} className={question.isSimulation ? "is-simulation" : ""}><div><b>{question.topic ?? (question.isSimulation ? "全真模擬試題" : "其他")} · {question.isSimulation ? "擬真題" : "正式題"} · {question.subject} · {question.year} · 第 {question.questionNumber} 題</b><small>q{question.id} · {plain(question.stem).slice(0, 150)}</small></div>{question.isSimulation ? <><span className={question.simulatedAnswerStatus === "ai_correct" ? "ready" : question.simulatedAnswerStatus === "ai_incorrect" ? "wrong" : "pending"}>{question.simulatedAnswer ? `AI：${question.simulatedAnswer}${question.simulatedAnswerStatus === "ai_correct" ? " · 答對" : question.simulatedAnswerStatus === "ai_incorrect" ? " · 答錯" : " · 待批改"}` : "待 AI 擬答"}</span><div className="simulation-review-controls"><span>AI答案：<b>{question.simulatedAnswer || "—"}</b></span><label>老師答案<select value={question.correctAnswer || ""} disabled={!question.simulatedAnswer || busy} onChange={(event) => void review(question, event.target.value)}><option value="">待批改</option>{["A", "B", "C", "D"].map((letter) => <option key={letter}>{letter}</option>)}</select></label></div><button disabled={busy || Boolean(question.simulatedAnswer && question.simulatedExplanation && question.simulatedCompleteExplanation)} onClick={() => { setBusy(true); setNotice(`正在產生第 ${question.questionNumber || question.id} 題擬真答案…`); void generate(question, true).then(() => setNotice(`第 ${question.questionNumber || question.id} 題擬真答案與解析已產生，請老師批改。`)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "產生失敗")).finally(() => setBusy(false)); }}>{question.simulatedAnswer ? "已產生" : "產生 AI 擬答"}</button></> : <><span className={plain(question.completeExplanation) ? "ready" : "pending"}>{plain(question.completeExplanation) ? "已有完整解析" : "待補正式解析"}</span><button disabled={busy || Boolean(plain(question.completeExplanation)) || !question.correctAnswer} onClick={() => { setBusy(true); setNotice(`正在產生第 ${question.questionNumber || question.id} 題正式解析…`); void generate(question).then(() => setNotice(`第 ${question.questionNumber || question.id} 題正式完整解析已產生，請開啟工作台核對。`)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "產生失敗")).finally(() => setBusy(false)); }}>{!question.correctAnswer ? "先補正式答案" : plain(question.completeExplanation) ? "已完成" : "產生正式解析"}</button></>}</article>)}{!pageItems.length && <p>找不到符合條件的題目。</p>}</div><div className="explanation-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一頁</button><span>第 {page}／{pageCount} 頁 · 每頁 {pageSize} 題</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一頁</button></div></>}</section>
  </>;
}
