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

type CoachMessage = { role: "mentor" | "student"; text: string };
type CoachRecommendation = { type: string; title: string; location: string; url: string; startSeconds: number | null };

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
  const [coachInput, setCoachInput] = useState("");
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachGap, setCoachGap] = useState("");
  const [coachIssue, setCoachIssue] = useState("");
  const [coachRecommendations, setCoachRecommendations] = useState<CoachRecommendation[]>([]);
  const [coaching, setCoaching] = useState(false);

  async function loadQuestion(type = examType) {
    setLoading(true);
    setSelected(null);
    setFeedback("");
    setEssayFeedback("");
    setEssayGrading(null);
    setEssay("");
    setCoachInput("");
    setCoachMessages([]);
    setCoachGap("");
    setCoachIssue("");
    setCoachRecommendations([]);
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
    const guidance = response.ok && result.correctAnswer ? `${result.correct ? "答對了。" : `正確答案是 ${result.correctAnswer}。`} ${result.guidance ?? "先說說你選這個答案的理由。"}` : result.error ?? "作答暫時無法儲存";
    setFeedback(guidance);
    if (response.ok) setCoachMessages([{ role: "mentor", text: guidance }]);
  }

  async function askCoach(action: "coach" | "variation_basic" | "variation_advanced" = "coach") {
    if (!question || coaching || (action === "coach" && !coachInput.trim())) return;
    const studentMessage = action === "coach" ? { role: "student" as const, text: coachInput.trim() } : null;
    const messages = studentMessage ? [...coachMessages, studentMessage] : coachMessages;
    if (studentMessage) setCoachMessages(messages);
    setCoaching(true);
    const response = await fetch("/api/practice-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, selectedAnswer: selected, action, messages }) });
    const result = await response.json() as { reply?: string; diagnosedGap?: string; keyIssue?: string; recommendations?: CoachRecommendation[]; error?: string };
    if (response.ok && result.reply) {
      setCoachMessages((current) => [...current, { role: "mentor", text: result.reply! }]);
      setCoachGap(result.diagnosedGap ?? "");
      setCoachIssue(result.keyIssue ?? "");
      setCoachRecommendations(result.recommendations ?? []);
      setCoachInput("");
    } else setCoachMessages((current) => [...current, { role: "mentor", text: result.error ?? "教練暫時無法接續，請稍後再試。" }]);
    setCoaching(false);
  }

  function recommendationUrl(item: CoachRecommendation) {
    if (!item.url || !item.startSeconds) return item.url;
    try {
      const url = new URL(item.url);
      if (url.hostname === "youtu.be") url.searchParams.set("t", String(item.startSeconds));
      else if (url.hostname.includes("youtube.com")) url.searchParams.set("t", `${item.startSeconds}s`);
      else url.hash = `t=${item.startSeconds}`;
      return url.toString();
    } catch { return item.url; }
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
    {loading ? <div className="practice-empty">正在從已審核題庫取題…</div> : question ? <article className="practice-question-panel"><div className="practice-question-meta"><span>{examType === "mcq" ? "一試" : "二試"}</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><p className="practice-question-stem">{question.stem}</p>{examType === "mcq" && question.options ? <><div className="practice-option-list">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button key={key} disabled={Boolean(selected)} className={selected === key ? "chosen" : ""} onClick={() => void answer(key)}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div>{selected && <section className="practice-coach"><header><div><span>真題教練</span><h3>回答教練，接著把這題學會</h3></div><div><button disabled={coaching} onClick={() => void askCoach("variation_basic")}>基礎變化題</button><button disabled={coaching} onClick={() => void askCoach("variation_advanced")}>進階變化題</button></div></header><div className="practice-coach-messages">{coachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}</div>{(coachIssue || coachGap) && <div className="practice-diagnosis">{coachIssue && <p><b>核心爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder="直接回答教練的問題；不知道也可以說你卡在哪裡" rows={3} /><button disabled={coaching || !coachInput.trim()}>{coaching ? "教練思考中…" : "送出回答"}</button></form>{coachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{coachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}</section>}</> : <div className="essay-practice"><div className="essay-source-note">{question.hasTeacherAnswer ? `已核對${question.answerSource || "老師參考擬答"}，AI 將依評分點批改。` : "這題尚未完成老師擬答核對，暫不能進行依擬答批改。"}</div><textarea value={essay} onChange={(event) => setEssay(event.target.value)} placeholder="先寫出：人物／行為／法律關係／爭點／你的初步結論" rows={9} /><button className="primary-btn" disabled={!essay.trim() || submitting || !question.hasTeacherAnswer} onClick={() => void submitEssay()}>{submitting ? "AI 分項批改中…" : "送出 AI 分項批改"}</button>{essayFeedback && <div className="essay-feedback"><strong>AI 申論批改</strong><p>{essayFeedback}</p></div>}{essayGrading && <div className="essay-grading-result"><div className="essay-score"><b>{essayGrading.score}</b><span>/ 100</span></div><p>{essayGrading.overall}</p><div className="essay-dimensions">{essayGrading.dimensions.map((item) => <article key={item.criterion}><strong>{item.criterion}　{item.score}/{item.max_score}</strong><p>{item.result}</p>{item.evidence && <small>你的作答依據：{item.evidence}</small>}{item.missing && <small>待補強：{item.missing}</small>}</article>)}</div>{essayGrading.priority_fixes.length > 0 && <div><strong>優先修正</strong><ul>{essayGrading.priority_fixes.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="essay-next-step"><strong>下一步</strong><p>{essayGrading.next_step}</p></div></div>}</div>}</article> : <div className="practice-empty">{feedback || "目前沒有可練習的題目。"}</div>}
  </section>;
}
