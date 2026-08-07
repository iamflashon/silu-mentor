"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Provider = "luna" | "sonnet" | "deepseek";
type DebateMode = "manual" | "countdown";
type ParticipantMode = "ai-scholar" | "student-scholar";
type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; hasTeacherAnswer?: boolean; answerSource?: string };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number };
type ModelRun = { model: string; text: string; usage?: Usage };
type ReviewResult = { question: Question; models: { teacher: string; scholar: string; commentator: string }; teacherQuestion: ModelRun | null; scholarAnswer: ModelRun | null; teacherFollowUp: ModelRun | null; scholarReply: ModelRun | null; teacherError?: string | null; scholarError?: string | null; commentator: ModelRun | null; commentatorError?: string; participantMode?: ParticipantMode };
type Phase = "teacher-question" | "scholar-answer" | "teacher-follow-up" | "scholar-reply" | "transition-verdict" | "verdict";

const modelLabels: Record<Provider, string> = { luna: "Luna", sonnet: "Claude Sonnet", deepseek: "DeepSeek V4-Pro" };
const modelNotes: Record<Provider, string> = { luna: "反應快｜適合白話提問", sonnet: "結構穩｜適合追問拆解", deepseek: "成本低｜適合大量測試" };

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
  const [scholarModel, setScholarModel] = useState<Provider>("sonnet");
  const [participantMode, setParticipantMode] = useState<ParticipantMode>("ai-scholar");
  const [debateMode, setDebateMode] = useState<DebateMode>("countdown");
  const [countdownSeconds, setCountdownSeconds] = useState(20);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activePanel, setActivePanel] = useState<"question" | "debate" | "verdict">("question");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const [debateCompleted, setDebateCompleted] = useState(false);

  useEffect(() => {
    fetch("/api/review").then(async (response) => {
      const data = await readReviewJson<{ questions?: Question[]; question?: Question | null }>(response);
      const nextQuestions = data.questions ?? [];
      const first = data.question ?? nextQuestions[0] ?? null;
      setQuestions(nextQuestions); setQuestion(first);
      setFilterYear(first?.year ?? ""); setFilterSubject(first?.subject ?? "");
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => [...new Set(questions.map((item) => item.year))].sort((a, b) => Number(b) - Number(a)), [questions]);
  const subjectsForYear = useMemo(() => [...new Set(questions.filter((item) => !filterYear || item.year === filterYear).map((item) => item.subject))], [questions, filterYear]);
  const questionsForSelection = useMemo(() => questions.filter((item) => (!filterYear || item.year === filterYear) && (!filterSubject || item.subject === filterSubject)), [questions, filterSubject, filterYear]);
  const questionMeta = useMemo(() => question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目", [question]);

  function chooseYear(year: string) {
    const nextSubject = [...new Set(questions.filter((item) => item.year === year).map((item) => item.subject))][0] ?? "";
    const nextQuestion = questions.find((item) => item.year === year && (!nextSubject || item.subject === nextSubject)) ?? null;
    setFilterYear(year); setFilterSubject(nextSubject); setQuestion(nextQuestion); setResult(null); setDebateCompleted(false); setActivePanel("question");
  }

  function chooseSubject(subject: string) {
    const nextQuestion = questions.find((item) => item.year === filterYear && item.subject === subject) ?? questions.find((item) => item.subject === subject) ?? null;
    setFilterSubject(subject); setQuestion(nextQuestion); setResult(null); setDebateCompleted(false); setActivePanel("question");
  }

  function chooseQuestion(id: string) {
    const next = questions.find((item) => item.id === Number(id));
    if (!next) return;
    setQuestion(next); setFilterYear(next.year); setFilterSubject(next.subject); setResult(null); setDebateCompleted(false); setActivePanel("question");
  }

  async function startDebate() {
    if (!question || running) return;
    setRunning(true); setResult(null); setDebateCompleted(false); setActivePanel("debate"); setSavedComment("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, teacherModel, scholarModel, participantMode, stage: participantMode === "student-scholar" ? "start" : "full" }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "司律評暫時無法開始");
      setResult(data);
    } catch (error) {
      setResult({ question, models: { teacher: modelLabels[teacherModel], scholar: participantMode === "student-scholar" ? "同學（學霸角色）" : modelLabels[scholarModel], commentator: "Sol" }, teacherQuestion: null, scholarAnswer: null, teacherFollowUp: null, scholarReply: null, commentator: null, participantMode, teacherError: error instanceof Error ? error.message : "暫時無法開始" });
    } finally { setRunning(false); }
  }

  function saveStudentView() {
    if (!rating && !comment.trim()) return;
    setSavedComment(`已記錄：${rating ? `學習評分 ${rating} 分` : ""}${rating && comment.trim() ? "｜" : ""}${comment.trim() || "沒有補充意見"}`);
    window.localStorage.setItem(`silu-review-feedback-${question?.id ?? "current"}`, JSON.stringify({ rating, comment: comment.trim(), updatedAt: new Date().toISOString() }));
  }

  return <main className="review-shell">
    <header className="review-topbar"><Link href="/" className="review-brand" aria-label="回到司律備考"><span className="review-mark">評</span><span><b>司律評</b><small>看懂一題，學會怎麼答</small></span></Link><nav aria-label="司律評導覽"><a className="active" href="#battle">對話觀戰</a><a href="#model-pk">模型選擇</a><a href="#expert">專業點評</a><Link href="/">回司律備考</Link></nav></header>
    <section className="review-hero"><div className="review-hero-copy"><p className="review-kicker">THE LAWYER DIALOGUE ROOM</p><h1>老師一句，<em>學霸接招</em>，<br />把漏洞問出來。</h1><p>不再一次攤開長篇答案。老師先問一個關鍵問題，學霸回答後，老師再追問漏洞，最後交給固定的 Sol 整理考場寫法。</p><div className="review-hero-actions"><a href="#battle" className="review-primary">開始一場對話 <span>↘</span></a><span className="review-status-dot"><i />共用司律備考真題與教材</span></div></div><div className="review-seal" aria-hidden="true"><span>司</span><strong>律</strong><b>評</b></div><div className="review-hero-lines" aria-hidden="true"><i /><i /><i /></div></section>
    <section className="review-workspace" id="battle">
      <aside className="review-sidebar"><div className="review-side-title"><span>今日觀戰</span><b>{questions.length ? `${questions.length} 題可選` : "題庫同步中"}</b></div><div className="review-filter"><div className="review-filter-caption">依序選擇題目</div><label>年度<select value={filterYear} onChange={(event) => chooseYear(event.target.value)} disabled={!years.length}><option value="">{loading ? "讀取中…" : "選擇年度"}</option>{years.map((year) => <option value={year} key={year}>{year} 年</option>)}</select></label><label>類科<select value={filterSubject} onChange={(event) => chooseSubject(event.target.value)} disabled={!subjectsForYear.length}><option value="">選擇類科</option>{subjectsForYear.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label><label>題目<select value={question?.id ?? ""} onChange={(event) => chooseQuestion(event.target.value)} disabled={!questionsForSelection.length}><option value="">{questionsForSelection.length ? "選擇題目" : "尚無可選題目"}</option>{questionsForSelection.map((item) => <option value={item.id} key={item.id}>第 {item.questionNumber} 題</option>)}</select></label></div><div className="review-selected-path">{question ? <><span>目前選擇</span><b>{question.year} 年｜{question.subject}</b><small>第 {question.questionNumber} 題</small></> : <span>請先選擇年度、類科與題目</span>}</div><div className="review-steps"><button className={activePanel === "question" ? "active" : ""} onClick={() => setActivePanel("question")}><b>01</b><span>先讀題目<small>確認對話背景</small></span></button><button className={activePanel === "debate" ? "active" : ""} onClick={() => setActivePanel("debate")}><b>02</b><span>老師問・學霸答<small>一問一答抓漏洞</small></span></button><button className={activePanel === "verdict" ? "active" : ""} onClick={() => setActivePanel("verdict")}><b>03</b><span>聽固定點評<small>Sol 整理考場寫法</small></span></button></div><div className="review-side-note"><span>司律評的核心</span><p>老師不直接公布答案，而是把一個個關鍵問題問出來，讓學霸回答、修正，再由點評人收束。</p></div></aside>
      <div className="review-main"><div className="review-main-head"><div><p>{questionMeta}</p><h2>{activePanel === "question" ? "先讀題目，再安排對話" : activePanel === "debate" ? "老師問・學霸答" : "固定點評人的判斷"}</h2></div><span className="review-confidential">資料依據 <b>{question?.hasTeacherAnswer ? "已連結老師擬答" : "題目資料已連結"}</b></span></div>
        {activePanel === "question" && <section className="review-question-card"><div className="review-question-label"><span>CASE FILE</span><b>{question?.hasTeacherAnswer ? "題目＋老師擬答" : "正式題目"}</b></div>{question ? <><h3>{question.stem.slice(0, 220)}{question.stem.length > 220 ? "…" : ""}</h3><details><summary>展開完整題目</summary><p>{question.stem}</p></details><div className="review-source-row"><span>來源：司律備考已發布題庫</span>{question.answerSource ? <span>核對：{question.answerSource}</span> : <span>老師擬答：尚未連結</span>}</div></> : <div className="review-empty">{loading ? "正在從司律備考讀取已發布的二試題目…" : "目前沒有已發布的二試申論題。請先在管理後台完成題目發布。"}</div>}</section>}
        {activePanel === "question" && <section className="review-model-stage" id="model-pk"><div className="review-section-heading"><div><span>BEFORE THE DIALOGUE</span><h3>先安排老師與學霸</h3></div><p>可選 AI 學霸觀戰，也可以由你親自扮演學霸。固定點評人仍由 GPT-5.6 Sol 擔任，負責最後判斷與整理。</p></div><div className="review-participant-mode" aria-label="選擇學霸角色"><button type="button" className={participantMode === "ai-scholar" ? "selected" : ""} onClick={() => setParticipantMode("ai-scholar")}><span>AI</span><div><b>AI 學霸觀戰</b><small>由模型回答，適合比較不同模型</small></div></button><button type="button" className={participantMode === "student-scholar" ? "selected" : ""} onClick={() => setParticipantMode("student-scholar")}><span>我</span><div><b>同學扮演學霸</b><small>自己回答、不限時間，真正練習三段論法</small></div></button></div><div className="review-model-pickers"><ModelPicker tone="positive" title="老師／追問模型" subtitle="提出問題／抓出論證漏洞" value={teacherModel} onChange={setTeacherModel} />{participantMode === "ai-scholar" ? <><div className="review-versus">↔</div><ModelPicker tone="negative" title="學霸／回答模型" subtitle="回答問題／補足規範涵攝" value={scholarModel} onChange={setScholarModel} /></> : <div className="review-student-role"><span>我</span><b>你就是學霸</b><small>下方會出現輸入框，讀完老師問題後再自行作答。</small></div>}</div><div className="review-fixed-judge"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人｜GPT-5.6 Sol</b><small>最後整理本回合真正爭點、誰抓到漏洞、哪裡仍需修正，以及考場應如何寫。</small></div><i>LOCKED</i></div>{participantMode === "ai-scholar" ? <div className="review-watch-settings"><div><b>對話方式</b><small>每次只出現一個小問題；你可以按繼續，也可以讓倒數結束後自動進入下一句。</small></div><div className="review-watch-mode"><button type="button" className={debateMode === "manual" ? "selected" : ""} onClick={() => setDebateMode("manual")}>手動繼續</button><button type="button" className={debateMode === "countdown" ? "selected" : ""} onClick={() => setDebateMode("countdown")}>倒數自動</button></div>{debateMode === "countdown" && <label className="review-countdown-select">每句間隔<select value={countdownSeconds} onChange={(event) => setCountdownSeconds(Number(event.target.value))}><option value={15}>15 秒</option><option value={20}>20 秒</option><option value={30}>30 秒</option><option value={45}>45 秒</option></select></label>}</div> : <div className="review-unlimited-note"><b>不限時間作答</b><span>沒有倒數、沒有自動送出。你可以先整理大前提，再寫小前提涵攝，完成後按送出。</span></div>}<button className="review-start-button" onClick={() => void startDebate()} disabled={!question || running}>{running ? <><span className="review-spinner" />正在準備老師的第一個問題…</> : <>{participantMode === "student-scholar" ? "開始，我來扮演學霸" : "開始老師與學霸的對話"} <span>→</span></>}</button></section>}
        {activePanel !== "question" && <DebatePanel key={`${question?.id ?? "none"}-${result ? "ready" : "loading"}`} question={question} result={result} running={running} mode={debateMode} countdownSeconds={countdownSeconds} participantMode={participantMode} teacherModel={teacherModel} onGoQuestion={() => setActivePanel("question")} onComplete={() => setDebateCompleted(true)} />}
        {result && !running && debateCompleted && <section className="review-feedback" id="student-feedback"><div><span className="review-feedback-kicker">YOUR VIEW</span><h3>換你評這場對話</h3><p>AI 點評是法律品質判斷；你的評分，代表這場對話對考生是否真的有幫助。</p></div><div className="review-rating"><span>學習實用度</span><button aria-label="評分 1 分" onClick={() => setRating(1)}>{stars(1)}</button><div className="review-rating-buttons">{[1, 2, 3, 4, 5].map((item) => <button key={item} className={rating === item ? "selected" : ""} onClick={() => setRating(item)}>{item}</button>)}</div></div><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="老師哪一句追問最有幫助？學霸哪裡還可以補強？" rows={3} /><button className="review-save-feedback" onClick={saveStudentView}>送出我的看法</button>{savedComment && <small className="review-saved-feedback">{savedComment}</small>}</section>}
      </div>
    </section>
    <footer className="review-footer"><span>司律評</span><p>老師一句一追問，學霸一句一修正，讓你看見申論題真正的得分差距。</p><Link href="/plan">從對話銜接到練真題 →</Link></footer>
  </main>;
}

function ModelPicker({ tone, title, subtitle, value, onChange }: { tone: "positive" | "negative"; title: string; subtitle: string; value: Provider; onChange: (value: Provider) => void }) {
  return <label className={`review-model-picker ${tone}`}><div className="review-picker-top"><span>{tone === "positive" ? "師" : "霸"}</span><b>{title}</b></div><select value={value} onChange={(event) => onChange(event.target.value as Provider)}>{Object.entries(modelLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>{modelNotes[value]}｜{subtitle}</small></label>;
}

function DebatePanel({ question, result, running, mode, countdownSeconds, participantMode, teacherModel, onGoQuestion, onComplete }: { question: Question | null; result: ReviewResult | null; running: boolean; mode: DebateMode; countdownSeconds: number; participantMode: ParticipantMode; teacherModel: Provider; onGoQuestion: () => void; onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>("teacher-question");
  const [remaining, setRemaining] = useState(countdownSeconds);
  const [autoPlay, setAutoPlay] = useState(mode === "countdown");

  useEffect(() => {
    if (!result || !autoPlay || phase === "verdict" || phase === "transition-verdict") return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    const advance = window.setTimeout(() => moveNext(), countdownSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(advance); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoPlay, result, countdownSeconds]);
  useEffect(() => { if (phase === "transition-verdict") { const timer = window.setTimeout(() => setPhase("verdict"), 1200); return () => window.clearTimeout(timer); } }, [phase]);
  useEffect(() => { if (phase === "verdict") onComplete(); }, [phase, onComplete]);

  if (participantMode === "student-scholar") return <StudentScholarPanel question={question} result={result} running={running} teacherModel={teacherModel} onGoQuestion={onGoQuestion} onComplete={onComplete} />;

  function moveNext() {
    setRemaining(countdownSeconds);
    if (phase === "teacher-question") setPhase("scholar-answer");
    else if (phase === "scholar-answer") setPhase("teacher-follow-up");
    else if (phase === "teacher-follow-up") setPhase("scholar-reply");
    else if (phase === "scholar-reply") setPhase("transition-verdict");
  }

  const dialogueQuestion = question ?? result?.question ?? null;
  if (running) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-live-orbit"><span>師</span><b>↔</b><span>霸</span></div><h3>正在準備第一個爭點</h3><p>老師與學霸會讀取同一題、老師擬答與評分重點；對話開始後，每次先說明一個爭點。</p><div className="review-loading-bar"><i /></div></section></div>;
  if (!result) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-no-result"><b>尚未開始觀戰</b><span>回到第一步選擇題目與模型。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section></div>;

  const teacherQuestion = cleanReviewText(result.teacherQuestion?.text || result.teacherError || "老師的問題尚未產生。");
  const scholarAnswer = cleanReviewText(result.scholarAnswer?.text || result.scholarError || "學霸的回答尚未產生。");
  const teacherFollowUp = cleanReviewText(result.teacherFollowUp?.text || result.teacherError || "老師的追問尚未產生。");
  const scholarReply = cleanReviewText(result.scholarReply?.text || result.scholarError || "學霸的回應尚未產生。");
  const visible = (target: Phase) => ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-verdict", "verdict"].indexOf(phase) >= ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-verdict", "verdict"].indexOf(target);
  const speaking = phase !== "transition-verdict" && phase !== "verdict";
  const title = phase === "teacher-question" ? "老師先鎖定一個爭點" : phase === "scholar-answer" ? "學霸針對爭點回答" : phase === "teacher-follow-up" ? "老師沿著同一爭點抓漏洞" : phase === "scholar-reply" ? "學霸補足爭點的規範與涵攝" : phase === "verdict" ? "固定點評人的爭點判斷" : "點評人串場中";
  const notice = phase === "teacher-question" ? "先說清楚這一回合要處理哪個法律爭點，再提出一個問題。" : phase === "scholar-answer" ? "學霸必須針對剛才的爭點，帶入題目事實回答。" : phase === "teacher-follow-up" ? "老師不換題，沿著同一個爭點把論證斷點問清楚。" : phase === "scholar-reply" ? "學霸要正面回應原爭點，補上規範與個案涵攝。" : phase === "transition-verdict" ? "對話完成，接下來由固定點評人整理這一回合的爭點。" : "先確認本回合真正的法律爭點，再整理漏洞與考場寫法。";
  const nextLabel = phase === "teacher-question" ? "繼續，請學霸回答" : phase === "scholar-answer" ? "繼續，聽老師追問" : phase === "teacher-follow-up" ? "繼續，請學霸回應" : "繼續，聽固定點評";

  return <section className="review-conversation-stage"><DialogueQuestion question={dialogueQuestion} /><div className="review-focus-note"><span>本回合討論方式</span><p>老師先界定一個爭點，學霸再用題目事實回答；後續追問與點評都不離開這個爭點。</p></div><div className="review-round-label"><span>ROUND 01｜老師與學霸</span><i />{phase === "verdict" ? "點評已完成" : autoPlay ? "倒數自動進行中" : "由你決定何時繼續"}</div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />LIVE DIALOGUE</span><h3>{title}</h3><p>{notice}</p></div>{speaking && <div className={`review-countdown ${remaining <= 5 ? "urgent" : ""}`} aria-label={`剩餘 ${remaining} 秒`}><b>{autoPlay ? remaining : "—"}</b><small>{autoPlay ? "秒後繼續" : "手動模式"}</small></div>}</div><div className="review-chat-thread"><div className="review-judge-line"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>{notice}</p></div>{visible("teacher-question") && <ArgumentBubble side="positive" label={result.models.teacher} title="老師｜先問爭點" text={teacherQuestion} error={Boolean(result.teacherError && !result.teacherQuestion?.text)} />}{visible("scholar-answer") && <ArgumentBubble side="negative" label={result.models.scholar} title="學霸｜回答爭點" text={scholarAnswer} error={Boolean(result.scholarError && !result.scholarAnswer?.text)} />}{visible("teacher-follow-up") && <ArgumentBubble side="positive" label={result.models.teacher} title="老師｜追問同一爭點" text={teacherFollowUp} error={Boolean(result.teacherError && !result.teacherFollowUp?.text)} />}{visible("scholar-reply") && <ArgumentBubble side="negative" label={result.models.scholar} title="學霸｜回應並補足" text={scholarReply} error={Boolean(result.scholarError && !result.scholarReply?.text)} />}{phase === "transition-verdict" && <div className="review-judge-line active"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>四句對話完成，現在整理誰抓到真正的得分點。</p></div>}{phase === "verdict" && <div className="review-commentator-card featured" id="expert"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{result.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{result.commentator?.text ? <p>{cleanReviewText(result.commentator.text)}</p> : <div className="review-commentator-empty">{cleanReviewText(result.commentatorError || "固定點評暫時沒有可顯示內容。")}</div>}</div>}</div>{phase === "transition-verdict" && <div className="review-transition-note"><span className="review-pulse" />對話已完成，準備進入固定點評</div>}{speaking && <div className="review-turn-controls"><button className="review-continue-button" onClick={moveNext}>{nextLabel}<span>→</span></button><button className={`review-auto-toggle ${autoPlay ? "active" : ""}`} onClick={() => { setAutoPlay((value) => !value); setRemaining(countdownSeconds); }}>{autoPlay ? "暫停倒數" : "開啟倒數自動"}</button><small>{autoPlay ? `時間到自動進入下一句；目前每句 ${countdownSeconds} 秒` : "你可以閱讀完，再按繼續"}</small></div>}{phase === "verdict" && <div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button></div>}</section>;
}

type StudentStage = "teacher-question" | "student-answer" | "teacher-follow-up" | "student-reply" | "verdict";

function StudentScholarPanel({ question, result, running, teacherModel, onGoQuestion, onComplete }: { question: Question | null; result: ReviewResult | null; running: boolean; teacherModel: Provider; onGoQuestion: () => void; onComplete: () => void }) {
  const [studentResult, setStudentResult] = useState<ReviewResult | null>(null);
  const [stage, setStage] = useState<StudentStage>("teacher-question");
  const [answer, setAnswer] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const liveResult = studentResult ?? result;

  async function submitAnswer() {
    if (!liveResult?.teacherQuestion?.text || !answer.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: liveResult.question.id, teacherModel, participantMode: "student-scholar", stage: "submit-answer", teacherQuestion: liveResult.teacherQuestion.text, studentAnswer: answer.trim() }) });
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
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: liveResult.question.id, teacherModel, participantMode: "student-scholar", stage: "submit-reply", teacherQuestion: liveResult.teacherQuestion.text, studentAnswer: answer.trim(), teacherFollowUp: liveResult.teacherFollowUp.text, studentReply: reply.trim() }) });
      const data = await readReviewJson<ReviewResult & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "固定點評暫時無法產生");
      setStudentResult(data); setStage("verdict"); onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "固定點評暫時無法產生");
    } finally { setBusy(false); }
  }

  const dialogueQuestion = question ?? liveResult?.question ?? null;
  if (running) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-live-orbit"><span>師</span><b>→</b><span>我</span></div><h3>正在準備老師的第一個爭點</h3><p>準備完成後，老師會先問一個爭點；接下來由你親自扮演學霸回答。</p><div className="review-loading-bar"><i /></div></section></div>;
  if (!liveResult) return <div className="review-dialogue-view"><DialogueQuestion question={dialogueQuestion} /><section className="review-live-stage"><div className="review-no-result"><b>尚未開始作答</b><span>回到第一步選擇題目與角色。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section></div>;

  const teacherQuestion = cleanReviewText(liveResult.teacherQuestion?.text || liveResult.teacherError || "老師的問題尚未產生。");
  const teacherFollowUp = cleanReviewText(liveResult.teacherFollowUp?.text || "老師追問會在你送出第一段回答後出現。");
  const answerText = cleanReviewText(liveResult.scholarAnswer?.text || answer);
  const replyText = cleanReviewText(liveResult.scholarReply?.text || reply);
  const isVerdict = stage === "verdict";

  return <section className="review-conversation-stage student-scholar-stage"><DialogueQuestion question={dialogueQuestion} /><div className="review-focus-note"><span>同學扮演學霸</span><p>不限時間。請先抓出本回合爭點，再依大前提、小前提、結論組織自己的回答；完成後由你按送出。</p></div><div className="review-round-label"><span>ROUND 01｜你來回答</span><i /><strong className="review-unlimited-badge">不限時間作答</strong></div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />STUDENT PRACTICE</span><h3>{isVerdict ? "固定點評人的爭點判斷" : stage === "teacher-question" ? "老師先鎖定一個爭點" : stage === "teacher-follow-up" ? "老師沿著同一爭點追問" : "你正在扮演學霸"}</h3><p>{isVerdict ? "現在由固定點評人整理你的回答與修正方向。" : "沒有倒數、沒有自動送出；可以慢慢想清楚再回答。"}</p></div><div className="review-unlimited-clock" aria-label="不限時間"><b>∞</b><small>不限時</small></div></div><div className="review-chat-thread"><div className="review-judge-line"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>{isVerdict ? "你的兩段回答已完成，現在整理爭點、漏洞與考場寫法。" : "我只負責最後點評；本階段由你親自回答，不會替你先寫答案。"}</p></div><ArgumentBubble side="positive" label={liveResult.models.teacher} title="老師｜先問爭點" text={teacherQuestion} /><div className="student-answer-box"><div className="student-answer-box-head"><span>我｜扮演學霸</span><small>第一段：回答老師剛才的爭點</small></div>{stage === "teacher-question" ? <><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={7} placeholder="請輸入你的回答。可以先寫大前提，再把題目事實涵攝進去，最後下結論。" disabled={busy} /><button type="button" className="student-submit-button" onClick={() => void submitAnswer()} disabled={busy || !answer.trim()}>{busy ? "老師整理追問中…" : "送出學霸回答，請老師追問"}<span>→</span></button></> : <div className="student-answer-preview"><p>{answerText}</p><small>已送出，內容可在下方回看</small></div>}</div>{stage !== "teacher-question" && <><ArgumentBubble side="positive" label={liveResult.models.teacher} title="老師｜追問同一爭點" text={teacherFollowUp} /><div className="student-answer-box"><div className="student-answer-box-head"><span>我｜扮演學霸</span><small>第二段：回應追問，補足規範與涵攝</small></div>{stage === "teacher-follow-up" ? <><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={7} placeholder="請回應老師追問，修正前一段不足，最後寫出考場應如何落筆。" disabled={busy} /><button type="button" className="student-submit-button" onClick={() => void submitReply()} disabled={busy || !reply.trim()}>{busy ? "Sol 點評整理中…" : "送出學霸回應，請 Sol 點評"}<span>→</span></button></> : <div className="student-answer-preview"><p>{replyText}</p><small>已送出，以下為固定點評</small></div>}</div></>}{isVerdict && <div className="review-commentator-card featured" id="expert"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{liveResult.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{liveResult.commentator?.text ? <p>{cleanReviewText(liveResult.commentator.text)}</p> : <div className="review-commentator-empty">{cleanReviewText(liveResult.commentatorError || "固定點評暫時沒有可顯示內容。")}</div>}</div>}{error && <p className="student-practice-error" role="alert">{error}</p>}</div>{isVerdict && <div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button></div>}</section>;
}

function DialogueQuestion({ question }: { question: Question | null }) {
  return <section className="review-dialogue-question"><div className="review-dialogue-question-head"><div><span>本場對話題目</span><b>{question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目"}</b></div>{question && <small>完整題目</small>}</div>{question ? <details open><summary>題目內容（可收合）</summary><p>{question.stem}</p></details> : <p className="review-dialogue-question-empty">請先回到第一步選擇一題已發布的司律二試申論題。</p>}</section>;
}

function ArgumentBubble({ side, label, title, text, error }: { side: "positive" | "negative"; label: string; title: string; text: string; error?: boolean }) {
  return <details className={`review-argument-bubble ${side}`} open><summary className="review-argument-summary"><span>{side === "positive" ? "師" : "霸"}</span><div><b>{title}</b><small>{label}</small></div><i>{side === "positive" ? "TEACHER" : "SCHOLAR"}<em className="review-bubble-open">收合</em><em className="review-bubble-closed">展開</em></i></summary><div className="review-argument-content"><p className={error ? "error" : ""}>{text}</p><footer><span>問題定位</span><span>規範依據</span><span>個案涵攝</span></footer></div></details>;
}
