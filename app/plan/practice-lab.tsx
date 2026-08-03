"use client";

import { useEffect, useState } from "react";

type PracticeQuestion = {
  id: number;
  examType: "mcq" | "essay";
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string> | null;
  hasTeacherAnswer?: boolean;
  answerSource?: string;
  answerStatus?: string;
};

type EssayGrading = {
  score: number;
  overall: string;
  dimensions: Array<{ criterion: string; score: number; max_score: number; result: string; evidence: string; missing: string }>;
  strengths: string[];
  priority_fixes: string[];
  next_step: string;
  source_used: string;
};

type Props = { initialType: "mcq" | "essay" };

export function PracticeLab({ initialType }: Props) {
  const [examType, setExamType] = useState<"mcq" | "essay">(initialType);
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [essay, setEssay] = useState("");
  const [essayFeedback, setEssayFeedback] = useState("");
  const [essayGrading, setEssayGrading] = useState<EssayGrading | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadQuestion(type = examType) {
    setLoading(true);
    setSelected(null);
    setFeedback("");
    setEssayFeedback("");
    setEssayGrading(null);
    setEssay("");
    try {
      const response = await fetch(`/api/practice?type=${type}`);
      const result = await response.json() as { question?: PracticeQuestion | null; message?: string };
      setQuestion(result.question ?? null);
      if (!result.question) setFeedback(result.message ?? "題庫尚未準備完成");
    } catch {
      setQuestion(null);
      setFeedback("題庫暫時無法讀取，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setExamType(initialType);
    void loadQuestion(initialType);
    // The gateway intentionally loads the selected exam type immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialType]);

  async function answer(answer: string) {
    if (!question || selected) return;
    setSelected(answer);
    const response = await fetch("/api/practice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.id, answer }),
    });
    const result = await response.json() as { correct?: boolean; correctAnswer?: string; guidance?: string; error?: string };
    setFeedback(response.ok && result.correctAnswer ? `${result.correct ? "答對了。" : `正確答案是 ${result.correctAnswer}。`}${result.guidance ?? "先說說你選這個答案的理由。"}` : result.error ?? "作答暫時無法儲存");
  }

  async function submitEssay() {
    if (!question || !essay.trim() || submitting) return;
    setSubmitting(true);
    setEssayFeedback("");
    setEssayGrading(null);
    try {
      const response = await fetch("/api/essay-grading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: question.id, answer: essay }),
      });
      const result = await response.json() as { grading?: EssayGrading; source?: { label?: string }; error?: string };
      if (response.ok && result.grading) {
        setEssayGrading(result.grading);
        setEssayFeedback(`本次依${result.source?.label ?? "老師參考擬答"}批改。`);
      } else setEssayFeedback(result.error ?? "申論批改暫時無法使用");
    } catch {
      setEssayFeedback("申論審題暫時無法使用，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="practice-lab" aria-label="主動刷題區">
    <div className="practice-lab-head">
      <div><p>ACTIVE PRACTICE</p><h2>主動刷題</h2><span>這裡是自己開始練習的地方；完成後會留下作答與弱點紀錄。</span></div>
      <div className="practice-switch"><button className={examType === "mcq" ? "active" : ""} onClick={() => { setExamType("mcq"); void loadQuestion("mcq"); }}>一試選擇題</button><button className={examType === "essay" ? "active" : ""} onClick={() => { setExamType("essay"); void loadQuestion("essay"); }}>二試申論題</button></div>
    </div>
    <div className="practice-lab-note"><b>{examType === "mcq" ? "一試" : "二試"}</b><span>{examType === "mcq" ? "先作答，再說明其他選項為什麼不對。" : "先寫出你的審題與答題骨架，再讓 AI 帶你修正。"}</span><button onClick={() => void loadQuestion()}>換一題</button></div>
    {loading ? <div className="practice-empty">正在從已審核題庫取題…</div> : question ? <article className="practice-question-panel"><div className="practice-question-meta"><span>{examType === "mcq" ? "一試" : "二試"}</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><p className="practice-question-stem">{question.stem}</p>{examType === "mcq" && question.options ? <div className="practice-option-list">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button key={key} disabled={Boolean(selected)} className={selected === key ? "chosen" : ""} onClick={() => void answer(key)}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div> : <div className="essay-practice"><div className="essay-source-note">{question.hasTeacherAnswer ? `已核對${question.answerSource || "老師參考擬答"}，AI 將依評分點批改。` : "這題尚未完成老師擬答核對，暫不能進行依擬答批改。"}</div><textarea value={essay} onChange={(event) => setEssay(event.target.value)} placeholder="先寫出：人物／行為／法律關係／爭點／你的初步結論" rows={9} /><button className="primary-btn" disabled={!essay.trim() || submitting || !question.hasTeacherAnswer} onClick={() => void submitEssay()}>{submitting ? "AI 分項批改中…" : "送出 AI 分項批改"}</button>{essayFeedback && <div className="essay-feedback"><strong>AI 申論批改</strong><p>{essayFeedback}</p></div>}{essayGrading && <div className="essay-grading-result"><div className="essay-score"><b>{essayGrading.score}</b><span>/ 100</span></div><p>{essayGrading.overall}</p><div className="essay-dimensions">{essayGrading.dimensions.map((item) => <article key={item.criterion}><strong>{item.criterion}　{item.score}/{item.max_score}</strong><p>{item.result}</p>{item.evidence && <small>你的作答依據：{item.evidence}</small>}{item.missing && <small>待補強：{item.missing}</small>}</article>)}</div>{essayGrading.priority_fixes.length > 0 && <div><strong>優先修正</strong><ul>{essayGrading.priority_fixes.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="essay-next-step"><strong>下一步</strong><p>{essayGrading.next_step}</p></div></div>}</div>}{feedback && <div className="practice-feedback"><strong>教練提醒</strong><p>{feedback}</p></div>}</article> : <div className="practice-empty">{feedback || "目前沒有可練習的題目。"}</div>}
  </section>;
}
