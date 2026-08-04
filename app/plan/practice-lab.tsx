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
    const response = await fetch("/api/practice-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, selectedAnswer: selected, studentAnswer: essay, action, messages }) });
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
    {examType === "mcq" ? <section className="practice-feature-guide" aria-label="一試功能解說">
      <header><div><b>一試怎麼練</b><span>從今天該做的題目開始，也可以依自己的需求選題。</span></div><small>作答後自動留下答對、答錯與弱點紀錄</small></header>
      <div className="practice-feature-grid">
        <button type="button" className="ready" onClick={() => void loadQuestion("mcq")}><span>01</span><strong>今日練習</strong><p>直接從已審核真題出一題，答完由 AI 追問理由，不只背答案。</p><em>現在開始</em></button>
        <article><span>02</span><strong>自訂練習</strong><p>依年份、科目、章節、題數與是否排除已作答題目建立練習。</p><em>下一階段加入篩選器</em></article>
        <article><span>03</span><strong>高頻法條</strong><p>用本站真題重新計算法條命題次數，點法條即可練相關題目。</p><em>題庫標註完成後開放</em></article>
      </div>
    </section> : <section className="practice-feature-guide essay-guide" aria-label="二試批改功能解說">
      <header><div><b>二試怎麼練</b><span>不是交卷後只看總分，而是先審題、再完整作答，最後逐項找出失分位置。</span></div><small>批改依已核對的老師參考擬答與評分點</small></header>
      <ol className="essay-workflow">
        <li><span>1</span><div><strong>審題引導</strong><p>先辨認人物、行為、法律關係與可能爭點。</p></div></li>
        <li><span>2</span><div><strong>完整作答</strong><p>依考場方式寫出規範、涵攝與結論。</p></div></li>
        <li><span>3</span><div><strong>採分點批改</strong><p>分別檢查爭點、法條、規範、涵攝、立場及結構表達。</p></div></li>
        <li><span>4</span><div><strong>安排補強</strong><p>把漏失爭點連回教材、法條與下一次重寫。</p></div></li>
      </ol>
      <p className="grading-scope-note"><b>你會看到：</b>總分與分項分數、學生原文依據、漏寫內容、優先修正項目及下一步。不同但有法律理由的見解，不會只因文字與擬答不同就判錯。</p>
    </section>}
    <div className="practice-lab-note"><b>{examType === "mcq" ? "一試" : "二試"}</b><span>{examType === "mcq" ? "先作答，再說明其他選項為什麼不對。" : "先寫出你的審題與答題骨架，再讓 AI 帶你修正。"}</span><button onClick={() => void loadQuestion()}>換一題</button></div>
    {loading ? <div className="practice-empty">正在從已審核題庫取題…</div> : question ? <article className="practice-question-panel"><div className="practice-question-meta"><span>{examType === "mcq" ? "一試" : "二試"}</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><p className="practice-question-stem">{question.stem}</p>{examType === "mcq" && question.options ? <><div className="practice-option-list">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button key={key} disabled={Boolean(selected)} className={selected === key ? "chosen" : ""} onClick={() => void answer(key)}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div>{selected && <section className="practice-coach"><header><div><span>真題教練</span><h3>回答教練，接著把這題學會</h3></div><div><button disabled={coaching} onClick={() => void askCoach("variation_basic")}>基礎變化題</button><button disabled={coaching} onClick={() => void askCoach("variation_advanced")}>進階變化題</button></div></header><div className="practice-coach-messages">{coachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}</div>{(coachIssue || coachGap) && <div className="practice-diagnosis">{coachIssue && <p><b>核心爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder="直接回答教練的問題；不知道也可以說你卡在哪裡" rows={3} /><button disabled={coaching || !coachInput.trim()}>{coaching ? "教練思考中…" : "送出回答"}</button></form>{coachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{coachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}</section>}</> : <div className="essay-practice"><div className="essay-source-note">{question.hasTeacherAnswer ? `已核對${question.answerSource || "老師參考擬答"}，AI 將依評分點批改。` : "這題尚未完成老師擬答核對，目前可先做審題對話；完成擬答核對後才開放分項批改。"}</div><section className="practice-coach essay-coach"><header><div><span>申論審題教練</span><h3>先說出你看到的爭點，再開始寫答案</h3></div><div><button disabled={coaching} onClick={() => void askCoach("variation_basic")}>基礎變化題</button><button disabled={coaching} onClick={() => void askCoach("variation_advanced")}>進階變化題</button></div></header><div className="practice-coach-messages">{coachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}</div>{(coachIssue || coachGap) && <div className="practice-diagnosis">{coachIssue && <p><b>核心爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder="例如：我認為本題爭點是……；不知道也可以直接說卡在哪裡" rows={3} /><button disabled={coaching || !coachInput.trim()}>{coaching ? "教練思考中…" : "送出審題"}</button></form>{coachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{coachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}</section><textarea value={essay} onChange={(event) => setEssay(event.target.value)} placeholder="先寫出：人物／行為／法律關係／爭點／你的初步結論" rows={9} /><button className="primary-btn" disabled={!essay.trim() || submitting || !question.hasTeacherAnswer} onClick={() => void submitEssay()}>{submitting ? "AI 分項批改中…" : "送出 AI 分項批改"}</button>{essayFeedback && <div className="essay-feedback"><strong>AI 申論批改</strong><p>{essayFeedback}</p></div>}{essayGrading && <div className="essay-grading-result"><div className="essay-score"><b>{essayGrading.score}</b><span>/ 100</span></div><p>{essayGrading.overall}</p><div className="essay-dimensions">{essayGrading.dimensions.map((item) => <article key={item.criterion}><strong>{item.criterion}　{item.score}/{item.max_score}</strong><p>{item.result}</p>{item.evidence && <small>你的作答依據：{item.evidence}</small>}{item.missing && <small>待補強：{item.missing}</small>}</article>)}</div>{essayGrading.priority_fixes.length > 0 && <div><strong>優先修正</strong><ul>{essayGrading.priority_fixes.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="essay-next-step"><strong>下一步</strong><p>{essayGrading.next_step}</p></div></div>}</div>}</article> : <div className="practice-empty">{feedback || "目前沒有可練習的題目。"}</div>}
  </section>;
}
