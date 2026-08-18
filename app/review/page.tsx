"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Provider = "luna" | "sonnet" | "deepseek";
type DebateMode = "manual" | "countdown";
type ParticipantMode = "ai-scholar" | "student-scholar";
type AnswerViewMode = "teacher" | "ai" | "split";
type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; hasTeacherAnswer?: boolean; teacherAnswer?: string; answerSource?: string };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number; estimatedCostUsdMicros?: number };
type ModelRun = { model: string; provider?: string; text: string; usage?: Usage; durationMs?: number; inputTokens?: number; outputTokens?: number; cachedTokens?: number; estimatedCostUsdMicros?: number };
type ArgumentStage = "major-premise" | "minor-premise" | "conclusion";
type AnswerPack = { teacherAnswer: string; answerSource: string; aiSuggestedAnswer: ModelRun | null; aiSuggestedError?: string; studentGrade?: ModelRun | null; studentGradeError?: string };
type ReviewResult = { question: Question; models: { teacher: string; scholar: string; scholarModels?: string[]; scholarProviders?: string[]; commentator: string }; scholarModels?: Provider[]; scholarAnswers?: ModelRun[]; scholarReplies?: ModelRun[]; scholarErrors?: Record<string, string>; argumentStage?: ArgumentStage; teacherQuestion: ModelRun | null; scholarAnswer: ModelRun | null; teacherFollowUp: ModelRun | null; scholarReply: ModelRun | null; teacherError?: string | null; scholarError?: string | null; commentator: ModelRun | null; commentatorError?: string; answerPack?: AnswerPack; participantMode?: ParticipantMode };
type Phase = "teacher-question" | "scholar-answer" | "teacher-follow-up" | "scholar-reply" | "transition-stage" | "transition-verdict" | "verdict";
type ReviewHistoryEntry = { id: number; attemptNumber: number; questionId: number; year: string; subject: string; questionNumber: string; participantMode: ParticipantMode; teacherModel: string; scholarModels: string[]; commentatorModel: string; stageCount: number; inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsdMicros: number; durationMs: number; createdAt: string | Date; resultJson: string };

const modelLabels: Record<Provider, string> = { luna: "Luna", sonnet: "Claude Sonnet", deepseek: "DeepSeek V4-Pro" };
const modelNotes: Record<Provider, string> = { luna: "反應快｜適合白話提問", sonnet: "結構穩｜適合追問拆解", deepseek: "成本低｜適合大量測試" };
const argumentStageLabels: Record<ArgumentStage, { short: string; full: string; prompt: string }> = {
  "major-premise": { short: "第一段｜大前提", full: "大前提：找出適用的法規、法理與判斷標準", prompt: "請先確認本題應適用的法規、法理、學說或實務判斷標準。" },
  "minor-premise": { short: "第二段｜小前提", full: "小前提：把題目事實涵攝進法律要件", prompt: "請把題目中的具體事實逐一涵攝到剛才的大前提與法律要件。" },
  conclusion: { short: "第三段｜結論", full: "結論：把本爭點的推論收束成考場答案", prompt: "請依前面的規範與涵攝，明確收束本爭點的法律結論與考場寫法。" },
};

const stageQuestionTitles: Record<ArgumentStage, string> = {
  "major-premise": "老師界定本題爭點",
  "minor-premise": "老師引導事實涵攝",
  conclusion: "老師要求收束結論",
};

const stageQuestionNotices: Record<ArgumentStage, string> = {
  "major-premise": "先確定本回合唯一爭點，再找出適用規範。",
  "minor-premise": "不重新找爭點，直接把題幹事實套入前段確定的法律要件。",
  conclusion: "不重新找爭點，直接依規範與涵攝作成法律結論。",
};

function nextArgumentStage(stage: ArgumentStage): ArgumentStage | null {
  return stage === "major-premise" ? "minor-premise" : stage === "minor-premise" ? "conclusion" : null;
}

function stars(value: number) { return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value); }

function cleanReviewText(text: string) {
  return text.replace(/```(?:[\w-]+)?\s*\n?/g, "").replace(/```/g, "").replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*[-*+]\s+/gm, "• ").replace(/[ \t]+\n/g, "\n").trim();
}

async function readReviewJson<T>(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`司律評服務回傳無法解析的內容（HTTP ${response.status}）。請稍後重試；若持續發生，請檢查模型服務設定。`);
  }
}

export default function ReviewPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [filterYear, setFilterYear] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [teacherModel, setTeacherModel] = useState<Provider>("luna");
  // 正式司律評是一場角色對話：老師與學霸各使用一個模型。
  // 多模型比較不屬於學生的正式作答流程，因此前台只保留單一學霸模型。
  const [scholarModels, setScholarModels] = useState<Provider[]>(["sonnet"]);
  const [participantMode, setParticipantMode] = useState<ParticipantMode>("ai-scholar");
  const [debateMode, setDebateMode] = useState<DebateMode>("manual");
  const [countdownSeconds, setCountdownSeconds] = useState(20);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activePanel, setActivePanel] = useState<"question" | "debate" | "verdict">("question");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const [debateCompleted, setDebateCompleted] = useState(false);
  const [completedRounds, setCompletedRounds] = useState<ReviewResult[]>([]);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/review").then(async (response) => {
      const data = await readReviewJson<{ questions?: Question[]; question?: Question | null }>(response);
      const nextQuestions = data.questions ?? [];
      const first = data.question ?? nextQuestions[0] ?? null;
      setQuestions(nextQuestions); setQuestion(first);
      setFilterYear(first?.year ?? ""); setFilterSubject(first?.subject ?? "");
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!question?.id) { setHistory([]); return; }
    fetch(`/api/review/history?questionId=${question.id}`).then(async (response) => {
      const data = await readReviewJson<{ attempts?: ReviewHistoryEntry[] }>(response);
      setHistory(data.attempts ?? []);
    }).catch(() => setHistory([]));
  }, [question?.id]);

  const years = useMemo(() => [...new Set(questions.map((item) => item.year))].sort((a, b) => Number(b) - Number(a)), [questions]);
  const subjectsForYear = useMemo(() => [...new Set(questions.filter((item) => !filterYear || item.year === filterYear).map((item) => item.subject))], [questions, filterYear]);
  const questionsForSelection = useMemo(() => questions.filter((item) => (!filterYear || item.year === filterYear) && (!filterSubject || item.subject === filterSubject)), [questions, filterSubject, filterYear]);
  const questionMeta = useMemo(() => question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目", [question]);

  function chooseYear(year: string) {
    const nextSubject = [...new Set(questions.filter((item) => item.year === year).map((item) => item.subject))][0] ?? "";
    const nextQuestion = questions.find((item) => item.year === year && (!nextSubject || item.subject === nextSubject)) ?? null;
    setFilterYear(year); setFilterSubject(nextSubject); setQuestion(nextQuestion); setResult(null); setCompletedRounds([]); setDebateCompleted(false); setActivePanel("question");
  }

  function chooseSubject(subject: string) {
    const nextQuestion = questions.find((item) => item.year === filterYear && item.subject === subject) ?? questions.find((item) => item.subject === subject) ?? null;
    setFilterSubject(subject); setQuestion(nextQuestion); setResult(null); setCompletedRounds([]); setDebateCompleted(false); setActivePanel("question");
  }

  function chooseQuestion(id: string) {
    const next = questions.find((item) => item.id === Number(id));
    if (!next) return;
    setQuestion(next); setFilterYear(next.year); setFilterSubject(next.subject); setResult(null); setCompletedRounds([]); setDebateCompleted(false); setActivePanel("question");
  }

  async function startDebate() {
    if (!question || running) return;
    setRunning(true); setResult(null); setCompletedRounds([]); setDebateCompleted(false); setActivePanel("debate"); setSavedComment("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, teacherModel, scholarModel: scholarModels[0], scholarModels, participantMode, stage: participantMode === "student-scholar" ? "start" : "teacher-question" }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "司律評暫時無法開始");
      setResult(data);
    } catch (error) {
      setResult({ question, argumentStage: "major-premise", models: { teacher: modelLabels[teacherModel], scholar: participantMode === "student-scholar" ? "同學（學霸角色）" : modelLabels[scholarModels[0]], scholarModels: participantMode === "student-scholar" ? ["同學（學霸角色）"] : scholarModels.map((model) => modelLabels[model]), commentator: "Sol" }, scholarModels, scholarAnswers: [], scholarReplies: [], teacherQuestion: null, scholarAnswer: null, teacherFollowUp: null, scholarReply: null, commentator: null, participantMode, teacherError: error instanceof Error ? error.message : "暫時無法開始" });
    } finally { setRunning(false); }
  }

  async function advanceAiTurn(current: ReviewResult, target: Extract<Phase, "scholar-answer" | "teacher-follow-up" | "scholar-reply">) {
    if (running) return false;
    setRunning(true);
    try {
      const stage = target === "scholar-answer" ? "scholar-answer" : target === "teacher-follow-up" ? "teacher-follow-up" : "scholar-reply";
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        questionId: current.question.id, teacherModel, scholarModel: scholarModels[0], scholarModels, participantMode: "ai-scholar", stage,
        argumentStage: current.argumentStage ?? "major-premise", teacherQuestion: current.teacherQuestion?.text,
        scholarAnswer: current.scholarAnswer?.text, teacherFollowUp: current.teacherFollowUp?.text,
        scholarReply: current.scholarReply?.text, scholarAnswers: current.scholarAnswers, scholarReplies: current.scholarReplies,
      }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "下一句對話暫時無法產生");
      setResult((existing) => existing ? { ...existing, ...data } : data);
      return true;
    } catch (error) {
      setResult((existing) => existing ? { ...existing, commentatorError: error instanceof Error ? error.message : "下一句對話暫時無法產生" } : existing);
      return false;
    } finally { setRunning(false); }
  }

  async function finalizeAiTurn(current: ReviewResult) {
    if (running) return false;
    setRunning(true);
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        questionId: current.question.id, teacherModel, scholarModel: scholarModels[0], scholarModels, participantMode: "ai-scholar", stage: "finalize",
        argumentStage: current.argumentStage ?? "major-premise", teacherQuestion: current.teacherQuestion?.text,
        scholarAnswer: current.scholarAnswer?.text, teacherFollowUp: current.teacherFollowUp?.text,
        scholarReply: current.scholarReply?.text, scholarAnswers: current.scholarAnswers, scholarReplies: current.scholarReplies,
        completedRounds: completedRounds.map((round) => ({ argumentStage: round.argumentStage, teacherQuestion: round.teacherQuestion?.text, scholarAnswer: round.scholarAnswer?.text, teacherFollowUp: round.teacherFollowUp?.text, scholarReply: round.scholarReply?.text })),
      }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "固定點評暫時無法產生");
      setResult((existing) => existing ? { ...existing, ...data } : data);
      return true;
    } catch (error) {
      setResult((existing) => existing ? { ...existing, commentatorError: error instanceof Error ? error.message : "固定點評暫時無法產生" } : existing);
      return false;
    } finally { setRunning(false); }
  }

  async function advanceAiStage(current: ReviewResult) {
    const currentStage = current.argumentStage ?? "major-premise";
    const targetStage = nextArgumentStage(currentStage);
    if (!targetStage || running) return;
    setRunning(true); setDebateCompleted(false);
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        questionId: current.question.id, teacherModel, scholarModel: scholarModels[0], scholarModels, participantMode: "ai-scholar", stage: "teacher-question", argumentStage: targetStage,
        teacherQuestion: current.teacherQuestion?.text, scholarAnswer: current.scholarAnswer?.text, teacherFollowUp: current.teacherFollowUp?.text, scholarReply: current.scholarReply?.text,
        scholarAnswers: current.scholarAnswers, scholarReplies: current.scholarReplies,
        completedRounds: completedRounds.map((round) => ({ argumentStage: round.argumentStage, teacherQuestion: round.teacherQuestion?.text, scholarAnswer: round.scholarAnswer?.text, teacherFollowUp: round.teacherFollowUp?.text, scholarReply: round.scholarReply?.text })),
      }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "下一段對話暫時無法開始");
      setCompletedRounds((rounds) => [...rounds, current]);
      setResult(data); setActivePanel("debate");
    } catch (error) {
      setResult((existing) => existing ? { ...existing, commentatorError: error instanceof Error ? error.message : "下一段對話暫時無法開始" } : existing);
    } finally { setRunning(false); }
  }

  function chooseScholarModel(model: Provider) {
    setScholarModels([model]);
  }

  async function saveCompletedRun(finalResult: ReviewResult, rounds: ReviewResult[]) {
    const models = finalResult.models.scholarModels?.length ? finalResult.models.scholarModels : scholarModels.map((model) => modelLabels[model]);
    const response = await fetch("/api/review/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      questionId: finalResult.question.id,
      participantMode: finalResult.participantMode ?? participantMode,
      teacherModel: finalResult.models.teacher,
      scholarModels: models,
      commentatorModel: finalResult.models.commentator,
      stageCount: rounds.length + 1,
      result: { rounds, final: finalResult },
    }) });
    if (response.ok) {
      const refreshed = await fetch(`/api/review/history?questionId=${finalResult.question.id}`);
      if (refreshed.ok) setHistory((await readReviewJson<{ attempts?: ReviewHistoryEntry[] }>(refreshed)).attempts ?? []);
    }
  }

  function handleReviewComplete(finalResult: ReviewResult, rounds: ReviewResult[]) {
    setDebateCompleted(true);
    void saveCompletedRun(finalResult, rounds);
  }

  function restartAttempt() {
    setResult(null); setCompletedRounds([]); setDebateCompleted(false); setSavedComment(""); setRating(0); setComment(""); setActivePanel("question");
  }

  function saveStudentView() {
    if (!rating && !comment.trim()) return;
    setSavedComment(`已記錄：${rating ? `學習評分 ${rating} 分` : ""}${rating && comment.trim() ? "｜" : ""}${comment.trim() || "沒有補充意見"}`);
    window.localStorage.setItem(`silu-review-feedback-${question?.id ?? "current"}`, JSON.stringify({ rating, comment: comment.trim(), updatedAt: new Date().toISOString() }));
  }

  return <main className="review-shell">
    <header className="review-topbar"><Link href="/law" className="review-brand" aria-label="回到司律備考"><span className="review-mark">評</span><span><b>司律評</b><small>看懂一題，學會怎麼答</small></span></Link><nav aria-label="司律評導覽"><a className="active" href="#battle">對話練習</a><a href="#model-pk">模型選擇</a><a href="#expert">專業點評</a><Link href="/law">回司律備考</Link></nav></header>
    <section className="review-hero"><div className="review-hero-copy"><p className="review-kicker">THE LAWYER DIALOGUE ROOM</p><h1>審題 <em>→</em> 檢核 <em>→</em> 辯證 <em>→</em> 學習</h1><p>逐步建立申論答題思路，完成擬答並獲得批改建議。</p><div className="review-hero-actions"><a href="#battle" className="review-primary">開始一場對話 <span>↘</span></a><span className="review-status-dot"><i />共用司律備考真題與教材</span></div></div><div className="review-seal" aria-hidden="true"><span>司</span><strong>律</strong><b>評</b></div><div className="review-hero-lines" aria-hidden="true"><i /><i /><i /></div></section>
    <section className="review-workspace" id="battle">
      <aside className="review-sidebar"><div className="review-side-title"><span>今日對話</span><b>{questions.length ? `${questions.length} 題可選` : "題庫同步中"}</b></div><div className="review-filter"><div className="review-filter-caption">依序選擇題目</div><label>年度<select value={filterYear} onChange={(event) => chooseYear(event.target.value)} disabled={!years.length}><option value="">{loading ? "讀取中…" : "選擇年度"}</option>{years.map((year) => <option value={year} key={year}>{year} 年</option>)}</select></label><label>類科<select value={filterSubject} onChange={(event) => chooseSubject(event.target.value)} disabled={!subjectsForYear.length}><option value="">選擇類科</option>{subjectsForYear.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label><label>題目<select value={question?.id ?? ""} onChange={(event) => chooseQuestion(event.target.value)} disabled={!questionsForSelection.length}><option value="">{questionsForSelection.length ? "選擇題目" : "尚無可選題目"}</option>{questionsForSelection.map((item) => <option value={item.id} key={item.id}>第 {item.questionNumber} 題</option>)}</select></label></div><div className="review-selected-path">{question ? <><span>目前選擇</span><b>{question.year} 年｜{question.subject}</b><small>第 {question.questionNumber} 題</small></> : <span>請先選擇年度、類科與題目</span>}</div><div className="review-steps"><button className={activePanel === "question" ? "active" : ""} onClick={() => setActivePanel("question")}><b>01</b><span>先讀題目<small>確認對話背景</small></span></button><button className={activePanel === "debate" ? "active" : ""} onClick={() => setActivePanel("debate")}><b>02</b><span>老師問・學霸答<small>一問一答抓漏洞</small></span></button><button className={activePanel === "verdict" ? "active" : ""} onClick={() => setActivePanel("verdict")}><b>03</b><span>聽固定點評<small>Sol 整理考場寫法</small></span></button></div><div className="review-side-note"><span>司律評的核心</span><p>老師不直接公布答案，而是把一個個關鍵問題問出來，讓學霸回答、修正，再由點評人收束。</p></div></aside>
      <div className="review-main"><div className="review-main-head"><div><p>{questionMeta}</p><h2>{activePanel === "question" ? "先讀題目，再安排對話" : activePanel === "debate" ? "老師問・學霸答" : "固定點評人的判斷"}</h2></div><span className="review-confidential">資料依據 <b>{question?.hasTeacherAnswer ? "已連結老師擬答" : "題目資料已連結"}</b></span></div>
        {activePanel === "question" && <section className="review-question-card"><div className="review-question-label"><span>CASE FILE</span><b>{question?.hasTeacherAnswer ? "題目＋老師擬答" : "正式題目"}</b></div>{question ? <><h3>{question.stem.slice(0, 220)}{question.stem.length > 220 ? "…" : ""}</h3><details><summary>展開完整題目</summary><p>{question.stem}</p></details><div className="review-source-row"><span>來源：司律備考已發布題庫</span>{question.answerSource ? <span>核對：{question.answerSource}</span> : <span>老師擬答：尚未連結</span>}</div></> : <div className="review-empty">{loading ? "正在從司律備考讀取已發布的二試題目…" : "目前沒有已發布的二試申論題。請先在管理後台完成題目發布。"}</div>}</section>}
        {activePanel === "question" && <section className="review-model-stage" id="model-pk"><div className="review-section-heading"><div><span>BEFORE THE DIALOGUE</span><h3>先安排老師與學霸</h3></div><p>老師與學霸各使用一個模型進行角色對話。固定點評人仍由 GPT-5.6 Sol 擔任，負責最後判斷與整理。</p></div><div className="review-participant-mode" aria-label="選擇學霸角色"><button type="button" className={participantMode === "ai-scholar" ? "selected" : ""} onClick={() => setParticipantMode("ai-scholar")}><span>AI</span><div><b>AI 學霸對話</b><small>由指定模型回答，依三段論法逐步追問</small></div></button><button type="button" className={participantMode === "student-scholar" ? "selected" : ""} onClick={() => setParticipantMode("student-scholar")}><span>我</span><div><b>同學扮演學霸</b><small>自己回答、不限時間，真正練習三段論法</small></div></button></div><div className={`review-model-pickers ${participantMode === "student-scholar" ? "student-mode" : ""}`}><ModelPicker tone="positive" title="老師／追問模型" subtitle="提出問題／抓出論證漏洞" value={teacherModel} onChange={setTeacherModel} />{participantMode === "ai-scholar" ? <><div className="review-versus">→</div><ModelPicker tone="negative" title="學霸模型" subtitle="回答問題／修正涵攝" value={scholarModels[0]} onChange={chooseScholarModel} /></> : <div className="review-student-role"><span>我</span><b>你就是學霸</b><small>下方會出現輸入框，讀完老師問題後再自行作答。</small></div>}</div><div className="review-fixed-judge"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人｜GPT-5.6 Sol</b><small>最後整理本回合真正爭點、誰抓到漏洞、哪裡仍需修正，以及考場應如何寫。</small></div><i>LOCKED</i></div>{participantMode === "ai-scholar" ? <div className="review-watch-settings"><div><b>對話方式</b><small>每次只出現一個小問題；老師與學霸依序回答，讓你看見同一爭點如何完成三段論法。</small></div><div className="review-watch-mode"><button type="button" className={debateMode === "manual" ? "selected" : ""} onClick={() => setDebateMode("manual")}>手動繼續</button><button type="button" className={debateMode === "countdown" ? "selected" : ""} onClick={() => setDebateMode("countdown")}>倒數自動</button></div>{debateMode === "countdown" && <label className="review-countdown-select">每句間隔<select value={countdownSeconds} onChange={(event) => setCountdownSeconds(Number(event.target.value))}><option value={15}>15 秒</option><option value={20}>20 秒</option><option value={30}>30 秒</option><option value={45}>45 秒</option></select></label>}</div> : <div className="review-unlimited-note"><b>不限時間作答</b><span>沒有倒數、沒有自動送出。你可以先整理大前提，再寫小前提涵攝，完成後按送出。</span></div>}<button className="review-start-button" onClick={() => void startDebate()} disabled={!question || running}>{running ? <><span className="review-spinner" />正在準備老師的第一個問題…</> : <>{participantMode === "student-scholar" ? "開始，我來扮演學霸" : "開始老師與學霸的對話"} <span>→</span></>}</button></section>}
        {activePanel === "question" && <ReviewHistoryPanel history={history} onRestart={restartAttempt} />}
        {activePanel !== "question" && <DebatePanel key={`${question?.id ?? "none"}-${result?.argumentStage ?? "major-premise"}-${participantMode}`} question={question} result={result} running={running} mode={debateMode} countdownSeconds={countdownSeconds} participantMode={participantMode} teacherModel={teacherModel} completedRounds={completedRounds} onAdvanceTurn={advanceAiTurn} onFinalize={finalizeAiTurn} onNextStage={(current) => void advanceAiStage(current)} onGoQuestion={() => setActivePanel("question")} onRestart={restartAttempt} onComplete={handleReviewComplete} />}
        {participantMode === "student-scholar" && result && !running && debateCompleted && <AnswerReviewPanel result={result} />}
        {result && !running && debateCompleted && <section className="review-feedback" id="student-feedback"><div><span className="review-feedback-kicker">YOUR VIEW</span><h3>換你評這場對話</h3><p>AI 點評是法律品質判斷；你的評分，代表這場對話對考生是否真的有幫助。</p></div><div className="review-rating"><span>學習實用度</span><button aria-label="評分 1 分" onClick={() => setRating(1)}>{stars(1)}</button><div className="review-rating-buttons">{[1, 2, 3, 4, 5].map((item) => <button key={item} className={rating === item ? "selected" : ""} onClick={() => setRating(item)}>{item}</button>)}</div></div><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="老師哪一句追問最有幫助？學霸哪裡還可以補強？" rows={3} /><button className="review-save-feedback" onClick={saveStudentView}>送出我的看法</button>{savedComment && <small className="review-saved-feedback">{savedComment}</small>}</section>}
      </div>
    </section>
    <footer className="review-footer"><span>司律評</span><p>老師一句一追問，學霸一句一修正，讓你看見申論題真正的得分差距。</p><Link href="/plan">從對話銜接到練真題 →</Link></footer>
  </main>;
}

function ModelPicker({ tone, title, subtitle, value, onChange }: { tone: "positive" | "negative"; title: string; subtitle: string; value: Provider; onChange: (value: Provider) => void }) {
  return <label className={`review-model-picker ${tone}`}><div className="review-picker-top"><span>{tone === "positive" ? "師" : "霸"}</span><b>{title}</b></div><select value={value} onChange={(event) => onChange(event.target.value as Provider)}>{Object.entries(modelLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>{modelNotes[value]}｜{subtitle}</small></label>;
}

function ModelComparisonTable({ result, compact = false }: { result: ReviewResult; compact?: boolean }) {
  const models = result.models.scholarModels?.length ? result.models.scholarModels : [result.models.scholar];
  if (models.length < 2) return null;
  const answers = result.scholarAnswers ?? [];
  const replies = result.scholarReplies ?? [];
  const providers = result.models.scholarProviders ?? ["luna", "sonnet", "deepseek"].slice(0, models.length);
  const findRun = (runs: ModelRun[], index: number) => runs.find((run) => run.provider === providers[index]) ?? runs[index];
  return <section className={`review-model-comparison ${compact ? "compact" : ""}`}><div className="review-model-comparison-head"><div><span>MODEL RECORD</span><h4>同題同提示詞｜模型回答紀錄</h4></div><small>{models.length} 個模型</small></div><div className="review-model-comparison-scroll"><table><thead><tr><th>對話節點</th>{models.map((model) => <th key={model}>{model}</th>)}</tr></thead><tbody><tr><th>學霸回答</th>{models.map((model, index) => <td key={`${model}-answer`}>{cleanReviewText(findRun(answers, index)?.text ?? result.scholarErrors?.[["luna", "sonnet", "deepseek"][index]] ?? "尚未產生")}</td>)}</tr><tr><th>學霸回應</th>{models.map((model, index) => <td key={`${model}-reply`}>{cleanReviewText(findRun(replies, index)?.text ?? result.scholarErrors?.[["luna", "sonnet", "deepseek"][index]] ?? "尚未產生")}</td>)}</tr></tbody></table></div></section>;
}

function ReviewHistoryPanel({ history, onRestart }: { history: ReviewHistoryEntry[]; onRestart: () => void }) {
  if (!history.length) return <section className="review-history-panel"><div className="review-history-head"><div><span>REVIEW HISTORY</span><h3>歷次對話</h3></div><p>完成一場對話後，系統會在這裡保留使用的模型與點評結果。</p></div><div className="review-history-empty">這一題還沒有作答紀錄。完成第一次對話後，下一次可以直接重做。</div></section>;
  return <section className="review-history-panel"><div className="review-history-head"><div><span>REVIEW HISTORY</span><h3>歷次對話紀錄</h3></div><button type="button" onClick={onRestart}>同題重新作答 <b>＋</b></button></div><div className="review-history-list">{history.map((entry) => { const saved = (() => { try { return JSON.parse(entry.resultJson) as { final?: ReviewResult; rounds?: ReviewResult[] }; } catch { return {}; } })(); const finalResult = saved.final; return <details className="review-history-item" key={entry.id}><summary><span><b>第 {entry.attemptNumber} 次</b><small>{entry.year}｜{entry.subject}｜第{entry.questionNumber}題　{new Date(entry.createdAt).toLocaleString("zh-TW", { hour12: false })}</small></span><strong>{entry.scholarModels.join("＋") || "同學作答"}</strong></summary><div className="review-history-body"><div className="review-history-meta"><span>老師：{entry.teacherModel}</span><span>學霸：{entry.scholarModels.join("＋") || "同學"}</span><span>點評：{entry.commentatorModel}</span><span>{entry.inputTokens + entry.outputTokens} tokens｜US$ {(entry.estimatedCostUsdMicros / 1_000_000).toFixed(5)}｜{Math.round(entry.durationMs / 100) / 10} 秒</span></div>{finalResult ? <><ModelComparisonTable result={finalResult} compact /><div className="review-history-verdict"><b>固定點評</b><ModelUsageMeta run={finalResult.commentator} /><p>{cleanReviewText(finalResult.commentator?.text ?? finalResult.commentatorError ?? "尚無點評內容")}</p></div></> : <p className="review-history-empty">本次紀錄只有模型設定，對答內容尚未保存。</p>}</div></details>; })}</div></section>;
}

function CompletedStageHistory({ rounds }: { rounds: ReviewResult[] }) {
  if (!rounds.length) return null;
  return <div className="review-completed-rounds"><span>已完成的前段</span>{rounds.map((round, index) => { const stage = round.argumentStage ?? "major-premise"; return <details key={`${stage}-${index}`}><summary><b>{argumentStageLabels[stage].short}</b><small>已完成，可收合回看</small></summary><div><p><strong>老師</strong>{cleanReviewText(round.teacherQuestion?.text ?? "")}</p><p><strong>學霸</strong>{cleanReviewText(round.scholarAnswer?.text ?? "")}</p><p><strong>老師追問</strong>{cleanReviewText(round.teacherFollowUp?.text ?? "")}</p><p><strong>學霸修正</strong>{cleanReviewText(round.scholarReply?.text ?? "")}</p></div></details>; })}</div>;
}

function DebatePanel({ question, result, running, mode, countdownSeconds, participantMode, teacherModel, completedRounds, onAdvanceTurn, onFinalize, onNextStage, onGoQuestion, onRestart, onComplete }: { question: Question | null; result: ReviewResult | null; running: boolean; mode: DebateMode; countdownSeconds: number; participantMode: ParticipantMode; teacherModel: Provider; completedRounds: ReviewResult[]; onAdvanceTurn: (result: ReviewResult, target: Extract<Phase, "scholar-answer" | "teacher-follow-up" | "scholar-reply">) => Promise<boolean>; onFinalize: (result: ReviewResult) => Promise<boolean>; onNextStage: (result: ReviewResult) => void; onGoQuestion: () => void; onRestart: () => void; onComplete: (result: ReviewResult, rounds: ReviewResult[]) => void }) {
  const [phase, setPhase] = useState<Phase>("teacher-question");
  const [remaining, setRemaining] = useState(countdownSeconds);
  const [autoPlay, setAutoPlay] = useState(mode === "countdown");
  const completionSent = useRef(false);

  useEffect(() => {
    if (!result || !autoPlay || phase === "verdict" || phase === "transition-stage" || phase === "transition-verdict") return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    const advance = window.setTimeout(() => moveNext(), countdownSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(advance); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoPlay, result, countdownSeconds]);
  useEffect(() => { if (phase === "transition-verdict") { const timer = window.setTimeout(() => setPhase("verdict"), 1200); return () => window.clearTimeout(timer); } }, [phase]);
  useEffect(() => { if (phase === "verdict" && result && !completionSent.current) { completionSent.current = true; onComplete(result, completedRounds); } }, [phase, result, completedRounds, onComplete]);

  if (participantMode === "student-scholar") return <StudentScholarPanel question={question} result={result} running={running} teacherModel={teacherModel} onGoQuestion={onGoQuestion} onRestart={onRestart} onComplete={onComplete} />;

  async function moveNext() {
    setRemaining(countdownSeconds);
    if (!result || running) return;
    if (phase === "teacher-question") {
      if (await onAdvanceTurn(result, "scholar-answer")) setPhase("scholar-answer");
    } else if (phase === "scholar-answer") {
      if (await onAdvanceTurn(result, "teacher-follow-up")) setPhase("teacher-follow-up");
    } else if (phase === "teacher-follow-up") {
      if (await onAdvanceTurn(result, "scholar-reply")) setPhase("scholar-reply");
    } else if (phase === "scholar-reply") {
      if (nextArgumentStage(result.argumentStage ?? "major-premise")) setPhase("transition-stage");
      else if (await onFinalize(result)) setPhase("transition-verdict");
    }
  }

  const dialogueQuestion = question ?? result?.question ?? null;
  const preparingStage = result ? nextArgumentStage(result.argumentStage ?? "major-premise") ?? (result.argumentStage ?? "major-premise") : "major-premise";
  if (running) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-live-orbit"><span>師</span><b>↔</b><span>霸</span></div><h3>正在準備{argumentStageLabels[preparingStage].short}</h3><p>{argumentStageLabels[preparingStage].full}。老師與學霸會沿用同一個法律爭點，接續前一段內容繼續對話。</p><div className="review-loading-bar"><i /></div></section></div>;
  if (!result) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-no-result"><b>尚未開始對話</b><span>回到第一步選擇題目與模型。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section></div>;

  const teacherQuestion = cleanReviewText(result.teacherQuestion?.text || result.teacherError || "老師的問題尚未產生。");
  const scholarAnswer = cleanReviewText(result.scholarAnswer?.text || result.scholarError || "學霸的回答尚未產生。");
  const teacherFollowUp = cleanReviewText(result.teacherFollowUp?.text || result.teacherError || "老師的追問尚未產生。");
  const scholarReply = cleanReviewText(result.scholarReply?.text || result.scholarError || "學霸的回應尚未產生。");
  const currentStage = result.argumentStage ?? "major-premise";
  const followingStage = nextArgumentStage(currentStage);
  const visible = (target: Phase) => ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-stage", "transition-verdict", "verdict"].indexOf(phase) >= ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-stage", "transition-verdict", "verdict"].indexOf(target);
  const speaking = phase !== "transition-stage" && phase !== "transition-verdict" && phase !== "verdict";
  const title = phase === "teacher-question" ? stageQuestionTitles[currentStage] : phase === "scholar-answer" ? `${argumentStageLabels[currentStage].short}回答` : phase === "teacher-follow-up" ? `${argumentStageLabels[currentStage].short}追問漏洞` : phase === "scholar-reply" ? `${argumentStageLabels[currentStage].short}補足推論` : phase === "transition-stage" ? `${argumentStageLabels[currentStage].short}完成` : phase === "verdict" ? "固定點評人的爭點判斷" : "點評人串場中";
  const notice = phase === "teacher-question" ? `${argumentStageLabels[currentStage].full}。${stageQuestionNotices[currentStage]}` : phase === "scholar-answer" ? `${argumentStageLabels[currentStage].full}。學霸只回答本段任務。` : phase === "teacher-follow-up" ? `${argumentStageLabels[currentStage].full}。老師沿著同一爭點追問本段漏洞，不重新開題。` : phase === "scholar-reply" ? `${argumentStageLabels[currentStage].full}。學霸只補足本段推論。` : phase === "transition-stage" ? followingStage ? `接下來不是結束，請按下方按鈕進入${argumentStageLabels[followingStage].short}。` : "三段論法已完成，接下來由固定點評人整理。" : phase === "transition-verdict" ? "三段論法完成，接下來由固定點評人整理這一回合。" : "先整理本回合的漏洞，再轉成考場寫法。";
  const nextLabel = phase === "teacher-question" ? "繼續，請學霸回答" : phase === "scholar-answer" ? "繼續，聽老師追問" : phase === "teacher-follow-up" ? "繼續，請學霸回應" : followingStage ? `完成${argumentStageLabels[currentStage].short}，進入${argumentStageLabels[followingStage].short}` : "繼續，聽固定點評";

  const isMultiModel = (result.models.scholarModels?.length ?? 0) > 1;
  return <section className="review-conversation-stage"><DialogueQuestion question={dialogueQuestion} /><CompletedStageHistory rounds={completedRounds} /><div className="review-focus-note"><span>三段論法</span><p>{argumentStageLabels[currentStage].full}。導師先問；按下按鈕後才產生學霸回答，雙方依序完成這一段。</p></div><div className="review-round-label"><span>{argumentStageLabels[currentStage].short}｜導師與學霸</span><i />{phase === "verdict" ? "點評已完成" : phase === "transition-stage" ? "等待進入下一段" : autoPlay ? "倒數自動進行中" : "請按按鈕接續對話"}</div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />LIVE DIALOGUE</span><h3>{title}</h3><p>{notice}</p></div>{speaking && <div className={`review-countdown ${remaining <= 5 ? "urgent" : ""}`} aria-label={`剩餘 ${remaining} 秒`}><b>{autoPlay ? remaining : "—"}</b><small>{autoPlay ? "秒後繼續" : "手動模式"}</small></div>}</div><div className="review-chat-thread">{visible("teacher-question") && <ArgumentBubble side="positive" label={result.models.teacher} title={`AI 導師｜${currentStage === "major-premise" ? "界定爭點與規範" : currentStage === "minor-premise" ? "引導事實涵攝" : "要求法律結論"}`} text={teacherQuestion} error={Boolean(result.teacherError && !result.teacherQuestion?.text)} />}{visible("scholar-answer") && (isMultiModel ? <ModelComparisonTable result={result} /> : <ArgumentBubble side="negative" label={result.models.scholar} title="AI 學霸｜回答本段問題" text={scholarAnswer} error={Boolean(result.scholarError && !result.scholarAnswer?.text)} />)}{visible("teacher-follow-up") && <ArgumentBubble side="positive" label={result.models.teacher} title={`AI 導師｜${currentStage === "major-premise" ? "追問規範漏洞" : currentStage === "minor-premise" ? "追問涵攝漏洞" : "追問結論漏洞"}`} text={teacherFollowUp} error={Boolean(result.teacherError && !result.teacherFollowUp?.text)} />}{visible("scholar-reply") && (isMultiModel ? <ModelComparisonTable result={result} /> : <ArgumentBubble side="negative" label={result.models.scholar} title="AI 學霸｜補足本段推論" text={scholarReply} error={Boolean(result.scholarError && !result.scholarReply?.text)} />)}{phase === "transition-verdict" && <div className="review-judge-line active"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>三段對話完成，現在整理誰抓到真正的得分點。</p></div>}{phase === "verdict" && <div className="review-commentator-card featured" id="expert"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{result.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{result.commentator?.text ? <p>{cleanReviewText(result.commentator.text)}</p> : <div className="review-commentator-empty">{cleanReviewText(result.commentatorError || "固定點評暫時沒有可顯示內容。")}</div>}</div>}</div>{phase === "transition-stage" && followingStage && <div className="review-stage-transition"><span className="review-pulse" /><div><b>{argumentStageLabels[currentStage].short}已完成</b><p>前一段內容已保留在上方。下一步要把同一個法律爭點帶入{argumentStageLabels[followingStage].short}。</p></div><button className="review-continue-button" onClick={() => onNextStage(result)}>{nextLabel}<span>→</span></button></div>}{phase === "transition-verdict" && <div className="review-transition-note"><span className="review-pulse" />三段論法已完成，準備進入固定點評</div>}{speaking && <div className="review-turn-controls"><button className="review-continue-button" onClick={() => void moveNext()}>{nextLabel}<span>→</span></button><button className={`review-auto-toggle ${autoPlay ? "active" : ""}`} onClick={() => { setAutoPlay((value) => !value); setRemaining(countdownSeconds); }}>{autoPlay ? "暫停倒數" : "開啟倒數自動"}</button><small>{autoPlay ? `時間到自動進入下一句；目前每句 ${countdownSeconds} 秒` : "你可以閱讀完，再按按鈕讓下一個角色回答"}</small></div>}{phase === "verdict" && <><AnswerReviewPanel result={result} /><div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button><button onClick={onRestart}>同題重新作答</button></div></>}</section>;
}

type StudentStage = "teacher-question" | "student-answer" | "teacher-follow-up" | "student-reply" | "stage-transition" | "verdict";

function AnswerReviewPanel({ result }: { result: ReviewResult }) {
  const [studentAnswer, setStudentAnswer] = useState("");
  const [grade, setGrade] = useState<ModelRun | null>(result.answerPack?.studentGrade ?? null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [answerViewMode, setAnswerViewMode] = useState<AnswerViewMode>("split");
  const teacherAnswer = result.answerPack?.teacherAnswer ?? result.question.teacherAnswer ?? "";
  const aiAnswer = result.answerPack?.aiSuggestedAnswer?.text ?? "";

  async function submitForGrading() {
    if (!studentAnswer.trim() || grading) return;
    setGrading(true); setError("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        questionId: result.question.id, stage: "grade-answer", studentAnswerForGrading: studentAnswer.trim(), aiSuggestedAnswer: aiAnswer,
      }) });
      const data = await readReviewJson<{ studentGrade?: ModelRun; error?: string }>(response);
      if (!response.ok || !data.studentGrade) throw new Error(data.error ?? "AI 批改暫時無法產生");
      setGrade(data.studentGrade);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 批改暫時無法產生");
    } finally { setGrading(false); }
  }

  return <section className="review-answer-lab" id="answer-lab"><div className="review-answer-lab-head"><div><span>AFTER THE THREE-PART ARGUMENT</span><h3>看擬答，再換你寫</h3></div><div className="review-answer-lab-head-right"><p>先以老師擬答作為主要依據，再看 Sol 依本題對話整理的 AI 建議擬答；最後由你自己作答，交由 AI 批改。</p><div className="review-answer-view-toggle" role="group" aria-label="答案檢視方式"><span>檢視方式</span><button type="button" className={answerViewMode === "teacher" ? "selected" : ""} aria-pressed={answerViewMode === "teacher"} onClick={() => setAnswerViewMode("teacher")}>只有老師</button><button type="button" className={answerViewMode === "ai" ? "selected" : ""} aria-pressed={answerViewMode === "ai"} onClick={() => setAnswerViewMode("ai")}>只有 AI</button><button type="button" className={answerViewMode === "split" ? "selected" : ""} aria-pressed={answerViewMode === "split"} onClick={() => setAnswerViewMode("split")}>分割畫面</button></div></div></div><div className="review-answer-source-note"><b>閱讀順序</b><span>① 老師擬答：主要校準依據</span><span>② AI 建議擬答：依老師擬答整理並標示差異</span><span>③ 同學作答：送出後再由 AI 批改</span></div><div className={`review-answer-columns review-answer-view-${answerViewMode}`}><details className="review-answer-card teacher" open><summary><span>老師擬答</span><small>{teacherAnswer ? (result.answerPack?.answerSource || result.question.answerSource || "題庫已連結") : "尚未提供"}</small></summary><div>{teacherAnswer ? <p>{cleanReviewText(teacherAnswer)}</p> : <p className="review-answer-empty">這一題目前沒有可顯示的老師擬答，系統不會自行捏造。</p>}</div></details><details className="review-answer-card ai" open><summary><span>AI 建議擬答</span><small>{teacherAnswer ? "依老師擬答核對" : "僅依題目整理"}｜{result.answerPack?.aiSuggestedAnswer ? result.answerPack.aiSuggestedAnswer.model : "Sol"}</small></summary><div>{aiAnswer ? <p>{cleanReviewText(aiAnswer)}</p> : <p className="review-answer-empty">{cleanReviewText(result.answerPack?.aiSuggestedError || "AI 建議擬答尚未產生，請重新完成本題後再試。")}</p>}</div></details></div><div className="review-student-essay"><div className="review-student-essay-head"><div><span>YOUR ANSWER</span><h4>同學自己作答</h4></div><small>不限時間；請直接寫完整申論答案</small></div><textarea value={studentAnswer} onChange={(event) => setStudentAnswer(event.target.value)} rows={10} placeholder="請依大前提 → 小前提 → 結論，寫出你的完整答案。" disabled={grading} /><div className="review-student-essay-actions"><button type="button" onClick={() => void submitForGrading()} disabled={grading || !studentAnswer.trim()}>{grading ? "Sol 正在批改…" : "送出答案，請 AI 批改"}<span>→</span></button><small>批改依據：題目、老師擬答、AI 建議擬答與司律二試答題結構</small></div>{error && <p className="review-answer-error" role="alert">{error}</p>}</div>{grade && <div className="review-grade-card"><div className="review-grade-head"><span className="review-judge-badge">S</span><div><b>AI 批改結果</b><strong>{grade.model}</strong></div><small>本次實際送出內容</small></div><p>{cleanReviewText(grade.text)}</p></div>}</section>;
}

function StudentScholarPanel({ question, result, running, teacherModel, onGoQuestion, onRestart, onComplete }: { question: Question | null; result: ReviewResult | null; running: boolean; teacherModel: Provider; onGoQuestion: () => void; onRestart: () => void; onComplete: (result: ReviewResult, rounds: ReviewResult[]) => void }) {
  const [studentResult, setStudentResult] = useState<ReviewResult | null>(null);
  const [stage, setStage] = useState<StudentStage>("teacher-question");
  const [answer, setAnswer] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [argumentStage, setArgumentStage] = useState<ArgumentStage>("major-premise");
  const [completedRounds, setCompletedRounds] = useState<ReviewResult[]>([]);

  const liveResult = studentResult ?? result;

  async function submitAnswer() {
    if (!liveResult?.teacherQuestion?.text || !answer.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: liveResult.question.id, teacherModel, participantMode: "student-scholar", stage: "submit-answer", argumentStage, teacherQuestion: liveResult.teacherQuestion.text, studentAnswer: answer.trim() }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "老師追問暫時無法產生");
      setStudentResult(data); setStage("teacher-follow-up");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "老師追問暫時無法產生");
    } finally { setBusy(false); }
  }

  async function submitReply() {
    if (!liveResult?.teacherQuestion?.text || !liveResult.teacherFollowUp?.text || !answer.trim() || !reply.trim() || busy) return;
    setBusy(true); setError("");
    const nextStage = nextArgumentStage(argumentStage);
    if (nextStage) {
      setStudentResult((current) => current ? { ...current, scholarReply: { model: "student", text: reply.trim(), durationMs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 } } : current);
      setStage("stage-transition"); setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: liveResult.question.id, teacherModel, participantMode: "student-scholar", stage: "submit-reply", argumentStage, teacherQuestion: liveResult.teacherQuestion.text, studentAnswer: answer.trim(), teacherFollowUp: liveResult.teacherFollowUp.text, studentReply: reply.trim(), completedRounds: completedRounds.map((round) => ({ argumentStage: round.argumentStage, teacherQuestion: round.teacherQuestion?.text, scholarAnswer: round.scholarAnswer?.text, teacherFollowUp: round.teacherFollowUp?.text, scholarReply: round.scholarReply?.text })) }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "固定點評暫時無法產生");
      setStudentResult(data); setStage("verdict"); onComplete(data, completedRounds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "固定點評暫時無法產生");
    } finally { setBusy(false); }
  }

  async function advanceStudentStage() {
    const targetStage = nextArgumentStage(argumentStage);
    if (!targetStage || !liveResult?.teacherQuestion?.text || !liveResult.teacherFollowUp?.text || !liveResult.scholarReply?.text || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        questionId: liveResult.question.id, teacherModel, participantMode: "student-scholar", stage: "next-stage", argumentStage: targetStage,
        teacherQuestion: liveResult.teacherQuestion.text, studentAnswer: liveResult.scholarAnswer?.text, teacherFollowUp: liveResult.teacherFollowUp.text, studentReply: liveResult.scholarReply.text,
      }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "下一段題目暫時無法產生");
      setCompletedRounds((rounds) => [...rounds, liveResult]);
      setStudentResult(data); setArgumentStage(targetStage); setAnswer(""); setReply(""); setStage("teacher-question");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下一段題目暫時無法產生");
    } finally { setBusy(false); }
  }

  const dialogueQuestion = question ?? liveResult?.question ?? null;
  if (running) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-live-orbit"><span>師</span><b>→</b><span>我</span></div><h3>正在準備{argumentStageLabels[argumentStage].short}</h3><p>{argumentStageLabels[argumentStage].full}。準備完成後，老師會接續這個法律爭點，讓你繼續作答。</p><div className="review-loading-bar"><i /></div></section></div>;
  if (!liveResult) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-no-result"><b>尚未開始作答</b><span>回到第一步選擇題目與角色。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section></div>;

  const teacherQuestion = cleanReviewText(liveResult.teacherQuestion?.text || liveResult.teacherError || "老師的問題尚未產生。");
  const teacherFollowUp = cleanReviewText(liveResult.teacherFollowUp?.text || "老師追問會在你送出第一段回答後出現。");
  const answerText = cleanReviewText(liveResult.scholarAnswer?.text || answer);
  const replyText = cleanReviewText(liveResult.scholarReply?.text || reply);
  const currentStage = liveResult.argumentStage ?? argumentStage;
  const followingStage = nextArgumentStage(currentStage);
  const isVerdict = stage === "verdict";
  const isTransition = stage === "stage-transition";

  return <section className="review-conversation-stage student-scholar-stage"><DialogueQuestion question={dialogueQuestion} /><CompletedStageHistory rounds={completedRounds} /><div className="review-focus-note"><span>同學扮演學霸</span><p>{argumentStageLabels[currentStage].full}。導師先提問，下面的輸入區只屬於你；你可以慢慢回答後再送出。</p></div><div className="review-round-label"><span>{argumentStageLabels[currentStage].short}｜你來回答導師</span><i /><strong className="review-unlimited-badge">不限時間作答</strong></div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />STUDENT PRACTICE</span><h3>{isVerdict ? "固定點評人的爭點判斷" : isTransition ? `${argumentStageLabels[currentStage].short}已完成` : stage === "teacher-question" ? "導師先提出問題" : stage === "teacher-follow-up" ? "導師沿著同一爭點追問" : "你正在扮演學霸"}</h3><p>{isVerdict ? "現在由固定點評人整理你的回答與修正方向。" : isTransition ? followingStage ? `接下來進入${argumentStageLabels[followingStage].short}。前一段內容已保留。` : "三段論法已完成，準備進入固定點評。" : "沒有倒數、沒有自動送出；輸入框只供你自己作答。"}</p></div><div className="review-unlimited-clock" aria-label="不限時間"><b>∞</b><small>不限時</small></div></div><div className="review-chat-thread"><ArgumentBubble side="positive" label={liveResult.models.teacher} title={`AI 導師｜${currentStage === "major-premise" ? "界定爭點與規範" : currentStage === "minor-premise" ? "引導事實涵攝" : "要求法律結論"}`} text={teacherQuestion} /><div className="student-answer-box"><div className="student-answer-box-head"><span>我｜扮演學霸</span><small>這裡只輸入你的回答，不會放入導師內容</small></div>{stage === "teacher-question" ? <><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={7} placeholder={argumentStageLabels[currentStage].prompt} disabled={busy} /><button type="button" className="student-submit-button" onClick={() => void submitAnswer()} disabled={busy || !answer.trim()}>{busy ? "導師整理追問中…" : "送出我的回答，請導師追問"}<span>→</span></button></> : <div className="student-answer-preview"><p>{answerText}</p><small>已送出，內容可在下方回看</small></div>}</div>{stage !== "teacher-question" && <><ArgumentBubble side="positive" label={liveResult.models.teacher} title={`AI 導師｜${currentStage === "major-premise" ? "追問規範漏洞" : currentStage === "minor-premise" ? "追問涵攝漏洞" : "追問結論漏洞"}`} text={teacherFollowUp} /><div className="student-answer-box"><div className="student-answer-box-head"><span>我｜扮演學霸</span><small>回應導師追問，補足規範與涵攝</small></div>{stage === "teacher-follow-up" ? <><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={7} placeholder="請回應導師追問，修正前一段不足，並完成這一段的答題。" disabled={busy} /><button type="button" className="student-submit-button" onClick={() => void submitReply()} disabled={busy || !reply.trim()}>{busy ? "處理中…" : followingStage ? `送出本段，進入${argumentStageLabels[followingStage].short}` : "送出學霸回答，請固定點評"}<span>→</span></button></> : <div className="student-answer-preview"><p>{replyText}</p><small>已送出，內容可在下方回看</small></div>}</div></>}{isTransition && followingStage && <div className="review-stage-transition"><span className="review-pulse" /><div><b>{argumentStageLabels[currentStage].short}已完成</b><p>現在把同一個法律爭點帶入{argumentStageLabels[followingStage].short}，不是重新選題。</p></div><button className="review-continue-button" onClick={() => void advanceStudentStage()} disabled={busy}>{busy ? "正在準備下一段…" : `進入${argumentStageLabels[followingStage].short}`}<span>→</span></button></div>}{isVerdict && <div className="review-commentator-card featured" id="expert"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{liveResult.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{liveResult.commentator?.text ? <p>{cleanReviewText(liveResult.commentator.text)}</p> : <div className="review-commentator-empty">{cleanReviewText(liveResult.commentatorError || "固定點評暫時沒有可顯示內容。")}</div>}</div>}{error && <p className="student-practice-error" role="alert">{error}</p>}</div>{isVerdict && <div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button><button onClick={onRestart}>同題重新作答</button></div>}</section>;
}

function DialogueQuestion({ question }: { question: Question | null }) {
  return <section className="review-dialogue-question"><div className="review-dialogue-question-head"><div><span>本場對話題目</span><b>{question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目"}</b></div>{question && <small>完整題目</small>}</div>{question ? <details open><summary>題目內容（可收合）</summary><p>{question.stem}</p></details> : <p className="review-dialogue-question-empty">請先回到第一步選擇一題已發布的司律二試申論題。</p>}</section>;
}

function ModelUsageMeta({ run }: { run?: ModelRun | null }) {
  if (!run || (!run.inputTokens && !run.outputTokens && !run.estimatedCostUsdMicros)) return null;
  const cost = (run.estimatedCostUsdMicros ?? 0) / 1_000_000;
  return <small className="review-usage-meta">{run.model} · 輸入 {(run.inputTokens ?? 0).toLocaleString()} · 輸出 {(run.outputTokens ?? 0).toLocaleString()} · 合計 {((run.inputTokens ?? 0) + (run.outputTokens ?? 0)).toLocaleString()} tokens · US$ {cost.toFixed(5)}</small>;
}

function ArgumentBubble({ side, label, title, text, error, usage }: { side: "positive" | "negative"; label: string; title: string; text: string; error?: boolean; usage?: ModelRun | null }) {
  return <details className={`review-argument-bubble ${side}`} open><summary className="review-argument-summary"><span>{side === "positive" ? "師" : "霸"}</span><div><b>{title}</b><small>{label}</small></div><i>{side === "positive" ? "TEACHER" : "SCHOLAR"}<em className="review-bubble-open">收合</em><em className="review-bubble-closed">展開</em></i></summary><div className="review-argument-content"><p className={error ? "error" : ""}>{text}</p><ModelUsageMeta run={usage} /><footer><span>問題定位</span><span>規範依據</span><span>個案涵攝</span></footer></div></details>;
}
