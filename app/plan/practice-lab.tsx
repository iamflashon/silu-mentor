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
  const [submitting, setSubmitting] = useState(false);

  async function loadQuestion(type = examType) {
    setLoading(true);
    setSelected(null);
    setFeedback("");
    setEssayFeedback("");
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
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "student", text: `這是司律二試申論題，請先做審題引導，不要直接給完整擬答。\n\n題目：${question.stem}\n\n我的答案：${essay}\n\n請依序指出我是否抓到人物、行為、法律關係與主要爭點，先給一個下一步可修正的小提示。` }] }),
      });
      const result = await response.json() as { reply?: string; error?: string };
      setEssayFeedback(response.ok ? result.reply ?? "AI 尚未產生回饋" : result.error ?? "申論審題暫時無法使用");
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
    {loading ? <div className="practice-empty">正在從已審核題庫取題…</div> : question ? <article className="practice-question-panel"><div className="practice-question-meta"><span>{examType === "mcq" ? "一試" : "二試"}</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><p className="practice-question-stem">{question.stem}</p>{examType === "mcq" && question.options ? <div className="practice-option-list">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button key={key} disabled={Boolean(selected)} className={selected === key ? "chosen" : ""} onClick={() => void answer(key)}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div> : <div className="essay-practice"><textarea value={essay} onChange={(event) => setEssay(event.target.value)} placeholder="先寫出：人物／行為／法律關係／爭點／你的初步結論" rows={9} /><button className="primary-btn" disabled={!essay.trim() || submitting} onClick={() => void submitEssay()}>{submitting ? "AI 審題中…" : "送出審題"}</button>{essayFeedback && <div className="essay-feedback"><strong>AI 審題回饋</strong><p>{essayFeedback}</p></div>}</div>}{feedback && <div className="practice-feedback"><strong>教練提醒</strong><p>{feedback}</p></div>}</article> : <div className="practice-empty">{feedback || "目前沒有可練習的題目。"}</div>}
  </section>;
}
