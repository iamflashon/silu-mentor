"use client";

import { useEffect, useMemo, useState } from "react";
import "./medtech-explanation-batch.css";

type Question = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  topic?: string;
  isSimulation?: boolean;
  simulatedAnswer?: string;
  simulatedExplanation?: string;
  simulatedCompleteExplanation?: string;
  aiCompleteExplanation?: string;
  teacherCompleteExplanation?: string;
  completeExplanation?: string;
  voiceScript?: string;
  teacherAnswer?: string;
  correctAnswer?: string | null;
};

function plain(value: string) { return String(value ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim(); }

export default function MedtechExplanationBatch() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("全部");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const all: Question[] = [];
      for (let page = 1; page <= 60; page += 1) {
        const response = await fetch(`/api/medtech/admin/questions?limit=100&page=${page}`, { cache: "no-store" });
        const data = await response.json() as { items?: Question[]; total?: number; error?: string };
        if (!response.ok) throw new Error(data.error || "題庫讀取失敗");
        all.push(...(data.items ?? []));
        if (all.length >= Number(data.total ?? all.length) || !(data.items ?? []).length) break;
      }
      setQuestions(all);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "題庫讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const simulated = questions.filter((question) => question.isSimulation);
  const pendingSimulation = simulated.filter((question) => !plain(question.simulatedAnswer || ""));
  const pendingAi = questions.filter((question) => !question.isSimulation && !plain(question.aiCompleteExplanation || ""));
  const pendingTeacher = questions.filter((question) => !question.isSimulation && !plain(question.teacherCompleteExplanation || question.completeExplanation || ""));
  const pendingVoice = questions.filter((question) => !question.isSimulation && !plain(question.teacherCompleteExplanation || question.completeExplanation || question.aiCompleteExplanation || ""));
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-Hant");
    return questions.filter((question) => {
      const matchTopic = topic === "全部" || question.topic === topic;
      const matchSearch = !keyword || `${question.year} ${question.subject} ${question.questionNumber} ${plain(question.stem)}`.toLocaleLowerCase("zh-Hant").includes(keyword);
      return matchTopic && matchSearch;
    });
  }, [questions, search, topic]);

  return <>
    <section className="medtech-admin-panel medtech-explanation-hero"><div><span>醫檢師 · 文件內解析狀態</span><h2>AI、老師解析與語音文字分開呈現</h2><p>AI 擬答、AI 完整解析與老師完整解析在「文件拆題工作區」內管理；老師／AI 完整解析完成後，可直接作為語音解析文字。本頁只提供整體狀態查看。</p></div><div className="explanation-count"><b>{questions.length}</b><small>題</small></div></section>
    <section className="medtech-admin-panel"><div className="simulation-accuracy-summary"><span>擬真題待 AI 擬答 <b>{pendingSimulation.length}</b></span><span>AI 完整解析待補 <b>{pendingAi.length}</b></span><span>老師解析待確認 <b>{pendingTeacher.length}</b></span><span>語音文字待補 <b>{pendingVoice.length}</b></span></div>{notice && <p className="medtech-admin-notice">{notice}</p>}<div className="explanation-search-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋年份、科目、題號或題幹" /><select aria-label="依題庫分類篩選" value={topic} onChange={(event) => setTopic(event.target.value)}>{["全部", "臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題", "其他"].map((item) => <option key={item}>{item}</option>)}</select><button type="button" onClick={() => void load()}>重新整理</button><span>顯示 {filtered.length} 題</span></div>{loading ? <p>正在讀取醫檢題庫…</p> : <div className="explanation-question-list">{filtered.map((question) => <article key={question.id} className={question.isSimulation ? "is-simulation" : ""}><div><b>{question.topic ?? (question.isSimulation ? "全真模擬試題" : "其他")} · {question.subject} · {question.year} · 第 {question.questionNumber} 題</b><small>q{question.id} · {plain(question.stem).slice(0, 150)}</small></div><div className="explanation-status-grid"><span className={question.isSimulation && question.simulatedAnswer ? "ready" : question.isSimulation ? "pending" : "muted"}>{question.isSimulation ? question.simulatedAnswer ? "AI 擬答已生成" : "待 AI 擬答" : "正式題"}</span><span className={plain(question.aiCompleteExplanation || "") ? "ready" : "pending"}>{plain(question.aiCompleteExplanation || "") ? "AI 完整解析" : "AI 解析待補"}</span><span className={plain(question.teacherCompleteExplanation || question.completeExplanation || "") ? "ready" : "pending"}>{plain(question.teacherCompleteExplanation || question.completeExplanation || "") ? "老師解析" : "老師解析待補"}</span><span className={plain(question.voiceScript || "") ? "ready" : "pending"}>{plain(question.voiceScript || "") ? "語音腳本" : "語音腳本待補"}</span></div></article>)}{!filtered.length && <p>找不到符合條件的題目。</p>}</div>}</section>
  </>;
}
