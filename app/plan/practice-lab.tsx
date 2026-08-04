"use client";

import { useEffect, useMemo, useState } from "react";

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
type PracticeMode = "today" | "custom" | "laws";
type PracticeFacets = { years: string[]; subjects: string[]; frequentLaws: Array<{ title: string; count: number }> };
type EssayMode = "guided" | "exam";

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
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("today");
  const [facets, setFacets] = useState<PracticeFacets>({ years: [], subjects: [], frequentLaws: [] });
  const [filterYear, setFilterYear] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [excludeAnswered, setExcludeAnswered] = useState(true);
  const [selectedLaw, setSelectedLaw] = useState("");
  const [essayMode, setEssayMode] = useState<EssayMode>("guided");
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [examMinutes, setExamMinutes] = useState(90);
  const [secondsLeft, setSecondsLeft] = useState(90 * 60);
  const [stemOpen, setStemOpen] = useState(true);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const draftKey = useMemo(() => question ? `silu-essay-draft:${question.id}` : "", [question]);
  const clockText = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  async function loadQuestion(type = examType, filters?: { year?: string; subject?: string; law?: string; excludeAnswered?: boolean }) {
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
      const params = new URLSearchParams({ type });
      if (filters?.year) params.set("year", filters.year);
      if (filters?.subject) params.set("subject", filters.subject);
      if (filters?.law) params.set("law", filters.law);
      if (filters?.excludeAnswered) params.set("excludeAnswered", "1");
      const response = await fetch(`/api/practice?${params}`);
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

  useEffect(() => {
    fetch(`/api/practice?type=${examType}&facets=1`).then(async (response) => {
      if (response.ok) setFacets(await response.json() as PracticeFacets);
    }).catch(() => undefined);
  }, [examType]);

  useEffect(() => {
    if (!draftKey || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(draftKey);
    if (saved && !essay) setEssay(saved);
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !essay || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, essay);
      setDraftSavedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftKey, essay]);

  useEffect(() => {
    if (!examStarted || examSubmitted || essayMode !== "exam") return;
    if (secondsLeft <= 0) { setExamSubmitted(true); void submitEssay(); return; }
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [examStarted, examSubmitted, essayMode, secondsLeft]);

  function beginMockExam() {
    setEssayMode("exam"); setExamStarted(true); setExamSubmitted(false);
    setSecondsLeft(examMinutes * 60); setStemOpen(true);
  }

  function submitMockExam() {
    if (!essay.trim()) return;
    setExamSubmitted(true); void submitEssay();
  }

  function chooseMode(mode: PracticeMode) {
    setPracticeMode(mode);
    setFeedback("");
  }

  function startCustomPractice() {
    void loadQuestion("mcq", { year: filterYear, subject: filterSubject, excludeAnswered });
  }

  function startLawPractice(law: string) {
    setSelectedLaw(law);
    void loadQuestion("mcq", { law });
  }

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
        <button type="button" className={practiceMode === "today" ? "ready active" : "ready"} onClick={() => { chooseMode("today"); void loadQuestion("mcq"); }}><span>01</span><strong>今日練習</strong><p>直接從已審核真題出一題，答完由 AI 追問理由，不只背答案。</p><em>現在開始</em></button>
        <button type="button" className={practiceMode === "custom" ? "active" : ""} onClick={() => chooseMode("custom")}><span>02</span><strong>自訂練習</strong><p>依年份、科目與是否排除已作答題目建立練習。</p><em>設定練習範圍 →</em></button>
        <button type="button" className={practiceMode === "laws" ? "active" : ""} onClick={() => chooseMode("laws")}><span>03</span><strong>高頻法條</strong><p>依本站已發布真題計算法條出現次數，點法條即可練相關題目。</p><em>查看高頻法條 →</em></button>
      </div>
      {practiceMode === "custom" && <section className="practice-mode-panel" aria-label="自訂練習篩選器"><header><b>設定自訂練習</b><span>選好範圍後，系統會從符合條件的已發布真題抽題。</span></header><div className="practice-filter-row"><label>年度<select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}><option value="">全部年度</option>{facets.years.map((year) => <option key={year}>{year}</option>)}</select></label><label>科目<select value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}><option value="">全部科目</option>{facets.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="practice-checkbox"><input type="checkbox" checked={excludeAnswered} onChange={(event) => setExcludeAnswered(event.target.checked)} />排除已作答題目</label><button type="button" onClick={startCustomPractice}>開始練習</button></div></section>}
      {practiceMode === "laws" && <section className="practice-mode-panel" aria-label="高頻法條選題"><header><b>高頻法條</b><span>統計目前已發布一試真題題幹中明確出現的法條。</span></header>{facets.frequentLaws.length ? <div className="frequent-law-list">{facets.frequentLaws.map((law) => <button type="button" className={selectedLaw === law.title ? "active" : ""} key={law.title} onClick={() => startLawPractice(law.title)}><strong>{law.title}</strong><span>{law.count} 題</span></button>)}</div> : <p className="practice-mode-empty">目前已發布題目尚未辨識到法條標註；後台補齊題目後，這裡會自動產生排行。</p>}</section>}
    </section> : <section className="practice-feature-guide essay-guide" aria-label="二試作答模式">
      <header><div><b>選擇二試練習方式</b><span>想學會審題就選引導練習；想測驗實力就進入限時擬真考試。</span></div><small>交卷後依已核對的老師參考擬答與評分點批改</small></header>
      <div className="essay-mode-grid">
        <button type="button" className={essayMode === "guided" ? "active" : ""} onClick={() => { setEssayMode("guided"); setExamStarted(false); }}><span>GUIDED PRACTICE</span><strong>引導練習</strong><p>AI 先陪你辨認人物、行為與爭點，再完成規範、涵攝及結論。</p><em>適合第一次練這類題型</em></button>
        <button type="button" className={essayMode === "exam" ? "active exam" : "exam"} onClick={() => setEssayMode("exam")}><span>MOCK EXAM</span><strong>擬真考試</strong><p>全程不提示、限時作答、自動存檔；交卷後才顯示分項批改。</p><em>適合整題實戰測驗</em></button>
      </div>
      {essayMode === "exam" && !examStarted && <div className="mock-exam-setup"><label>作答時間<select value={examMinutes} onChange={(event) => setExamMinutes(Number(event.target.value))}><option value={30}>30 分鐘</option><option value={60}>60 分鐘</option><option value={90}>90 分鐘</option><option value={120}>120 分鐘</option></select></label><label>年度<select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}><option value="">全部年度</option>{facets.years.map((year) => <option key={year}>{year}</option>)}</select></label><label>科目<select value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}><option value="">全部科目</option>{facets.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><button type="button" onClick={() => { void loadQuestion("essay", { year: filterYear, subject: filterSubject }); beginMockExam(); }}>開始考試</button></div>}
      <ol className="essay-workflow">
        <li><span>1</span><div><strong>審題引導</strong><p>先辨認人物、行為、法律關係與可能爭點。</p></div></li>
        <li><span>2</span><div><strong>完整作答</strong><p>依考場方式寫出規範、涵攝與結論。</p></div></li>
        <li><span>3</span><div><strong>採分點批改</strong><p>分別檢查爭點、法條、規範、涵攝、立場及結構表達。</p></div></li>
        <li><span>4</span><div><strong>安排補強</strong><p>把漏失爭點連回教材、法條與下一次重寫。</p></div></li>
      </ol>
      <p className="grading-scope-note"><b>你會看到：</b>總分與分項分數、學生原文依據、漏寫內容、優先修正項目及下一步。不同但有法律理由的見解，不會只因文字與擬答不同就判錯。</p>
    </section>}
    <div className="practice-lab-note"><b>{examType === "mcq" ? "一試" : essayMode === "exam" ? "擬真考試" : "引導練習"}</b><span>{examType === "mcq" ? "先作答，再說明其他選項為什麼不對。" : essayMode === "exam" ? "考試中不提供提示，交卷後才會批改。" : "先寫出你的審題與答題骨架，再讓 AI 帶你修正。"}</span>{!(essayMode === "exam" && examStarted) && <button onClick={() => void loadQuestion()}>換一題</button>}</div>
    {examType === "essay" && essayMode === "exam" && examStarted && question && <article className="mock-exam-standalone" aria-label="二試擬真考卷"><header><div><span>二試線上模擬考卷</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><div className="mock-clock"><small>剩餘時間</small><strong className={secondsLeft < 300 ? "urgent" : ""}>{clockText}</strong></div></header><div className="mock-exam-actions"><button type="button" onClick={() => setStemOpen((value) => !value)}>{stemOpen ? "收合題目" : "展開題目"}</button><span>{draftSavedAt ? `已於 ${draftSavedAt} 自動儲存` : "答案將自動儲存"}</span><b>{essay.length} 字</b></div>{stemOpen && <section className="mock-question"><strong>題目</strong><p>{question.stem}</p></section>}<section className="answer-sheet"><div className="answer-sheet-heading"><strong>作答區</strong><span>請依正式考試層次作答：一、（一）1.（1）</span></div><textarea value={essay} onChange={(event) => setEssay(event.target.value)} disabled={examSubmitted} placeholder="請開始作答……" aria-label="申論作答內容" /><footer><span>第 1 頁</span><button type="button" disabled={!essay.trim() || submitting || examSubmitted || !question.hasTeacherAnswer} onClick={submitMockExam}>{submitting ? "正在批改…" : examSubmitted ? "已交卷" : "確認交卷"}</button></footer></section>{!question.hasTeacherAnswer && <p className="mock-exam-warning">本題尚未完成老師擬答核對，目前可作答並儲存，但暫不開放正式交卷批改。</p>}{essayFeedback && <div className="essay-feedback"><strong>AI 申論批改</strong><p>{essayFeedback}</p></div>}{essayGrading && <div className="essay-grading-result"><div className="essay-score"><b>{essayGrading.score}</b><span>/ 100</span></div><p>{essayGrading.overall}</p><div className="essay-dimensions">{essayGrading.dimensions.map((item) => <article key={item.criterion}><strong>{item.criterion}　{item.score}/{item.max_score}</strong><p>{item.result}</p>{item.evidence && <small>你的作答依據：{item.evidence}</small>}{item.missing && <small>待補強：{item.missing}</small>}</article>)}</div></div>}</article>}
    {loading ? <div className="practice-empty">正在從已審核題庫取題…</div> : question ? <article className="practice-question-panel"><div className="practice-question-meta"><span>{examType === "mcq" ? "一試" : "二試"}</span><b>{question.year} · {question.subject} · 第 {question.questionNumber} 題</b></div><p className="practice-question-stem">{question.stem}</p>{examType === "mcq" && question.options ? <><div className="practice-option-list">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button key={key} disabled={Boolean(selected)} className={selected === key ? "chosen" : ""} onClick={() => void answer(key)}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div>{selected && <section className="practice-coach"><header><div><span>真題教練</span><h3>回答教練，接著把這題學會</h3></div><div><button disabled={coaching} onClick={() => void askCoach("variation_basic")}>基礎變化題</button><button disabled={coaching} onClick={() => void askCoach("variation_advanced")}>進階變化題</button></div></header><div className="practice-coach-messages">{coachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}</div>{(coachIssue || coachGap) && <div className="practice-diagnosis">{coachIssue && <p><b>核心爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder="直接回答教練的問題；不知道也可以說你卡在哪裡" rows={3} /><button disabled={coaching || !coachInput.trim()}>{coaching ? "教練思考中…" : "送出回答"}</button></form>{coachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{coachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}</section>}</> : <div className="essay-practice"><div className="essay-source-note">{question.hasTeacherAnswer ? `已核對${question.answerSource || "老師參考擬答"}，AI 將依評分點批改。` : "這題尚未完成老師擬答核對，目前可先做審題對話；完成擬答核對後才開放分項批改。"}</div><section className="practice-coach essay-coach"><header><div><span>申論審題教練</span><h3>先說出你看到的爭點，再開始寫答案</h3></div><div><button disabled={coaching} onClick={() => void askCoach("variation_basic")}>基礎變化題</button><button disabled={coaching} onClick={() => void askCoach("variation_advanced")}>進階變化題</button></div></header><div className="practice-coach-messages">{coachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}</div>{(coachIssue || coachGap) && <div className="practice-diagnosis">{coachIssue && <p><b>核心爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder="例如：我認為本題爭點是……；不知道也可以直接說卡在哪裡" rows={3} /><button disabled={coaching || !coachInput.trim()}>{coaching ? "教練思考中…" : "送出審題"}</button></form>{coachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{coachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}</section><textarea value={essay} onChange={(event) => setEssay(event.target.value)} placeholder="先寫出：人物／行為／法律關係／爭點／你的初步結論" rows={9} /><button className="primary-btn" disabled={!essay.trim() || submitting || !question.hasTeacherAnswer} onClick={() => void submitEssay()}>{submitting ? "AI 分項批改中…" : "送出 AI 分項批改"}</button>{essayFeedback && <div className="essay-feedback"><strong>AI 申論批改</strong><p>{essayFeedback}</p></div>}{essayGrading && <div className="essay-grading-result"><div className="essay-score"><b>{essayGrading.score}</b><span>/ 100</span></div><p>{essayGrading.overall}</p><div className="essay-dimensions">{essayGrading.dimensions.map((item) => <article key={item.criterion}><strong>{item.criterion}　{item.score}/{item.max_score}</strong><p>{item.result}</p>{item.evidence && <small>你的作答依據：{item.evidence}</small>}{item.missing && <small>待補強：{item.missing}</small>}</article>)}</div>{essayGrading.priority_fixes.length > 0 && <div><strong>優先修正</strong><ul>{essayGrading.priority_fixes.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="essay-next-step"><strong>下一步</strong><p>{essayGrading.next_step}</p></div></div>}</div>}</article> : <div className="practice-empty">{feedback || "目前沒有可練習的題目。"}</div>}
  </section>;
}
