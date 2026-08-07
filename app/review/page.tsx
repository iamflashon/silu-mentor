"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Provider = "luna" | "sonnet" | "deepseek";
type DebateMode = "manual" | "countdown";
type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; hasTeacherAnswer?: boolean; answerSource?: string };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number };
type ModelRun = { model: string; text: string; usage?: Usage };
type ReviewResult = { question: Question; models: { teacher: string; scholar: string; commentator: string }; teacherQuestion: ModelRun | null; scholarAnswer: ModelRun | null; teacherFollowUp: ModelRun | null; scholarReply: ModelRun | null; teacherError?: string | null; scholarError?: string | null; commentator: ModelRun | null; commentatorError?: string };
type Phase = "teacher-question" | "scholar-answer" | "teacher-follow-up" | "scholar-reply" | "transition-verdict" | "verdict";

const modelLabels: Record<Provider, string> = { luna: "Luna", sonnet: "Claude Sonnet", deepseek: "DeepSeek V4-Pro" };
const modelNotes: Record<Provider, string> = { luna: "反應快｜適合白話提問", sonnet: "結構穩｜適合追問拆解", deepseek: "成本低｜適合大量測試" };

function stars(value: number) { return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value); }

function cleanReviewText(text: string) {
  return text.replace(/```(?:[\w-]+)?\s*\n?/g, "").replace(/```/g, "").replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*[-*+]\s+/gm, "• ").replace(/[ \t]+\n/g, "\n").trim();
}

export default function ReviewPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [teacherModel, setTeacherModel] = useState<Provider>("luna");
  const [scholarModel, setScholarModel] = useState<Provider>("sonnet");
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
      const data = await response.json() as { questions?: Question[]; question?: Question | null };
      setQuestions(data.questions ?? []); setQuestion(data.question ?? null);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const questionMeta = useMemo(() => question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目", [question]);

  async function startDebate() {
    if (!question || running) return;
    setRunning(true); setResult(null); setDebateCompleted(false); setActivePanel("debate"); setSavedComment("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, teacherModel, scholarModel }) });
      const data = await response.json() as ReviewResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "司律評暫時無法開始");
      setResult(data);
    } catch (error) {
      setResult({ question, models: { teacher: modelLabels[teacherModel], scholar: modelLabels[scholarModel], commentator: "Sol" }, teacherQuestion: null, scholarAnswer: null, teacherFollowUp: null, scholarReply: null, commentator: null, teacherError: error instanceof Error ? error.message : "暫時無法開始" });
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
      <aside className="review-sidebar"><div className="review-side-title"><span>今日觀戰</span><b>{questions.length ? `${questions.length} 題可選` : "題庫同步中"}</b></div><div className="review-filter"><label>選擇歷屆題目<select value={question?.id ?? ""} onChange={(event) => { const next = questions.find((item) => item.id === Number(event.target.value)); if (next) { setQuestion(next); setResult(null); setDebateCompleted(false); setActivePanel("question"); } }} disabled={!questions.length}><option value="">{loading ? "讀取已發布題目…" : questions.length ? "請選擇題目" : "尚無已發布申論題"}</option>{questions.map((item) => <option value={item.id} key={item.id}>{item.year}｜{item.subject}｜第{item.questionNumber}題</option>)}</select></label></div><div className="review-steps"><button className={activePanel === "question" ? "active" : ""} onClick={() => setActivePanel("question")}><b>01</b><span>先讀題目<small>確認對話背景</small></span></button><button className={activePanel === "debate" ? "active" : ""} onClick={() => setActivePanel("debate")}><b>02</b><span>老師問・學霸答<small>一問一答抓漏洞</small></span></button><button className={activePanel === "verdict" ? "active" : ""} onClick={() => setActivePanel("verdict")}><b>03</b><span>聽固定點評<small>Sol 整理考場寫法</small></span></button></div><div className="review-side-note"><span>司律評的核心</span><p>老師不直接公布答案，而是把一個個關鍵問題問出來，讓學霸回答、修正，再由點評人收束。</p></div></aside>
      <div className="review-main"><div className="review-main-head"><div><p>{questionMeta}</p><h2>{activePanel === "question" ? "先讀題目，再安排對話" : activePanel === "debate" ? "老師問・學霸答" : "固定點評人的判斷"}</h2></div><span className="review-confidential">資料依據 <b>{question?.hasTeacherAnswer ? "已連結老師擬答" : "題目資料已連結"}</b></span></div>
        {activePanel === "question" && <section className="review-question-card"><div className="review-question-label"><span>CASE FILE</span><b>{question?.hasTeacherAnswer ? "題目＋老師擬答" : "正式題目"}</b></div>{question ? <><h3>{question.stem.slice(0, 220)}{question.stem.length > 220 ? "…" : ""}</h3><details><summary>展開完整題目</summary><p>{question.stem}</p></details><div className="review-source-row"><span>來源：司律備考已發布題庫</span>{question.answerSource ? <span>核對：{question.answerSource}</span> : <span>老師擬答：尚未連結</span>}</div></> : <div className="review-empty">{loading ? "正在從司律備考讀取已發布的二試題目…" : "目前沒有已發布的二試申論題。請先在管理後台完成題目發布。"}</div>}</section>}
        {activePanel === "question" && <section className="review-model-stage" id="model-pk"><div className="review-section-heading"><div><span>BEFORE THE DIALOGUE</span><h3>先安排老師與學霸</h3></div><p>兩個角色都可以更換模型做測試；固定點評人仍由 GPT-5.6 Sol 擔任，負責最後判斷與整理。</p></div><div className="review-model-pickers"><ModelPicker tone="positive" title="老師／追問模型" subtitle="提出問題／抓出論證漏洞" value={teacherModel} onChange={setTeacherModel} /><div className="review-versus">↔</div><ModelPicker tone="negative" title="學霸／回答模型" subtitle="回答問題／補足規範涵攝" value={scholarModel} onChange={setScholarModel} /></div><div className="review-fixed-judge"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人｜GPT-5.6 Sol</b><small>最後整理本回合真正爭點、誰抓到漏洞、哪裡仍需修正，以及考場應如何寫。</small></div><i>LOCKED</i></div><div className="review-watch-settings"><div><b>對話方式</b><small>每次只出現一個小問題；你可以按繼續，也可以讓倒數結束後自動進入下一句。</small></div><div className="review-watch-mode"><button type="button" className={debateMode === "manual" ? "selected" : ""} onClick={() => setDebateMode("manual")}>手動繼續</button><button type="button" className={debateMode === "countdown" ? "selected" : ""} onClick={() => setDebateMode("countdown")}>倒數自動</button></div>{debateMode === "countdown" && <label className="review-countdown-select">每句間隔<select value={countdownSeconds} onChange={(event) => setCountdownSeconds(Number(event.target.value))}><option value={15}>15 秒</option><option value={20}>20 秒</option><option value={30}>30 秒</option><option value={45}>45 秒</option></select></label>}</div><button className="review-start-button" onClick={() => void startDebate()} disabled={!question || running}>{running ? <><span className="review-spinner" />正在準備老師的第一個問題…</> : <>開始老師與學霸的對話 <span>→</span></>}</button></section>}
        {activePanel !== "question" && <DebatePanel result={result} running={running} panel={activePanel} mode={debateMode} countdownSeconds={countdownSeconds} onGoQuestion={() => setActivePanel("question")} onComplete={() => setDebateCompleted(true)} />}
        {result && !running && debateCompleted && <section className="review-feedback" id="student-feedback"><div><span className="review-feedback-kicker">YOUR VIEW</span><h3>換你評這場對話</h3><p>AI 點評是法律品質判斷；你的評分，代表這場對話對考生是否真的有幫助。</p></div><div className="review-rating"><span>學習實用度</span><button aria-label="評分 1 分" onClick={() => setRating(1)}>{stars(1)}</button><div className="review-rating-buttons">{[1, 2, 3, 4, 5].map((item) => <button key={item} className={rating === item ? "selected" : ""} onClick={() => setRating(item)}>{item}</button>)}</div></div><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="老師哪一句追問最有幫助？學霸哪裡還可以補強？" rows={3} /><button className="review-save-feedback" onClick={saveStudentView}>送出我的看法</button>{savedComment && <small className="review-saved-feedback">{savedComment}</small>}</section>}
      </div>
    </section>
    <footer className="review-footer"><span>司律評</span><p>老師一句一追問，學霸一句一修正，讓你看見申論題真正的得分差距。</p><Link href="/plan">從對話銜接到練真題 →</Link></footer>
  </main>;
}

function ModelPicker({ tone, title, subtitle, value, onChange }: { tone: "positive" | "negative"; title: string; subtitle: string; value: Provider; onChange: (value: Provider) => void }) {
  return <label className={`review-model-picker ${tone}`}><div className="review-picker-top"><span>{tone === "positive" ? "師" : "霸"}</span><b>{title}</b></div><select value={value} onChange={(event) => onChange(event.target.value as Provider)}>{Object.entries(modelLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>{modelNotes[value]}｜{subtitle}</small></label>;
}

function DebatePanel({ result, running, panel, mode, countdownSeconds, onGoQuestion, onComplete }: { result: ReviewResult | null; running: boolean; panel: "debate" | "verdict"; mode: DebateMode; countdownSeconds: number; onGoQuestion: () => void; onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>("teacher-question");
  const [remaining, setRemaining] = useState(countdownSeconds);
  const [autoPlay, setAutoPlay] = useState(mode === "countdown");

  useEffect(() => { if (result) { setPhase("teacher-question"); setRemaining(countdownSeconds); setAutoPlay(mode === "countdown"); } }, [result, countdownSeconds, mode]);
  useEffect(() => {
    if (!result || !autoPlay || phase === "verdict" || phase === "transition-verdict") return;
    setRemaining(countdownSeconds);
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    const advance = window.setTimeout(() => moveNext(), countdownSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(advance); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoPlay, result, countdownSeconds]);
  useEffect(() => { if (phase === "transition-verdict") { const timer = window.setTimeout(() => setPhase("verdict"), 1200); return () => window.clearTimeout(timer); } }, [phase]);
  useEffect(() => { if (phase === "verdict") onComplete(); }, [phase, onComplete]);

  function moveNext() {
    setRemaining(countdownSeconds);
    if (phase === "teacher-question") setPhase("scholar-answer");
    else if (phase === "scholar-answer") setPhase("teacher-follow-up");
    else if (phase === "teacher-follow-up") setPhase("scholar-reply");
    else if (phase === "scholar-reply") setPhase("transition-verdict");
  }

  if (running) return <section className="review-live-stage"><div className="review-live-orbit"><span>師</span><b>↔</b><span>霸</span></div><h3>Sol 正在安排第一個問題</h3><p>老師與學霸會讀取同一題、老師擬答與評分重點；對話開始後，每次只出現一句。</p><div className="review-loading-bar"><i /></div></section>;
  if (!result) return <section className="review-live-stage"><div className="review-no-result"><b>尚未開始觀戰</b><span>回到第一步選擇題目與模型。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section>;

  const teacherQuestion = cleanReviewText(result.teacherQuestion?.text || result.teacherError || "老師的問題尚未產生。");
  const scholarAnswer = cleanReviewText(result.scholarAnswer?.text || result.scholarError || "學霸的回答尚未產生。");
  const teacherFollowUp = cleanReviewText(result.teacherFollowUp?.text || result.teacherError || "老師的追問尚未產生。");
  const scholarReply = cleanReviewText(result.scholarReply?.text || result.scholarError || "學霸的回應尚未產生。");
  const visible = (target: Phase) => ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-verdict", "verdict"].indexOf(phase) >= ["teacher-question", "scholar-answer", "teacher-follow-up", "scholar-reply", "transition-verdict", "verdict"].indexOf(target);
  const speaking = phase !== "transition-verdict" && phase !== "verdict";
  const title = phase === "teacher-question" ? "老師先問一個關鍵問題" : phase === "scholar-answer" ? "學霸回答，先不要急著看答案" : phase === "teacher-follow-up" ? "老師抓住漏洞，再追問一句" : phase === "scholar-reply" ? "學霸回應，補上規範與涵攝" : phase === "verdict" ? "固定點評人的判斷" : "點評人串場中";
  const notice = phase === "teacher-question" ? "先定位本題最容易失分的核心問題。" : phase === "scholar-answer" ? "請聽學霸如何回答老師剛才的問題。" : phase === "teacher-follow-up" ? "老師不公布結論，先把論證的斷點問清楚。" : phase === "scholar-reply" ? "學霸要正面回應追問，不能只重複原本答案。" : phase === "transition-verdict" ? "對話完成，接下來由固定點評人收束。" : "現在整理本回合的爭點、漏洞與考場寫法。";
  const nextLabel = phase === "teacher-question" ? "繼續，請學霸回答" : phase === "scholar-answer" ? "繼續，聽老師追問" : phase === "teacher-follow-up" ? "繼續，請學霸回應" : "繼續，聽固定點評";

  return <section className="review-conversation-stage"><div className="review-round-label"><span>ROUND 01｜老師與學霸</span><i />{phase === "verdict" ? "點評已完成" : autoPlay ? "倒數自動進行中" : "由你決定何時繼續"}</div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />LIVE DIALOGUE</span><h3>{title}</h3><p>{notice}</p></div>{speaking && <div className={`review-countdown ${remaining <= 5 ? "urgent" : ""}`} aria-label={`剩餘 ${remaining} 秒`}><b>{autoPlay ? remaining : "—"}</b><small>{autoPlay ? "秒後繼續" : "手動模式"}</small></div>}</div><div className="review-chat-thread"><div className="review-judge-line"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>{notice}</p></div>{visible("teacher-question") && <ArgumentBubble side="positive" label={result.models.teacher} title="老師｜先問" text={teacherQuestion} error={Boolean(result.teacherError && !result.teacherQuestion?.text)} />}{visible("scholar-answer") && <ArgumentBubble side="negative" label={result.models.scholar} title="學霸｜回答" text={scholarAnswer} error={Boolean(result.scholarError && !result.scholarAnswer?.text)} />}{visible("teacher-follow-up") && <ArgumentBubble side="positive" label={result.models.teacher} title="老師｜追問漏洞" text={teacherFollowUp} error={Boolean(result.teacherError && !result.teacherFollowUp?.text)} />}{visible("scholar-reply") && <ArgumentBubble side="negative" label={result.models.scholar} title="學霸｜回應修正" text={scholarReply} error={Boolean(result.scholarError && !result.scholarReply?.text)} />}{phase === "transition-verdict" && <div className="review-judge-line active"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>四句對話完成，現在整理誰抓到真正的得分點。</p></div>}{phase === "verdict" && <div className="review-commentator-card featured" id="expert"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{result.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{result.commentator?.text ? <p>{cleanReviewText(result.commentator.text)}</p> : <div className="review-commentator-empty">{cleanReviewText(result.commentatorError || "固定點評暫時沒有可顯示內容。")}</div>}</div>}</div>{phase === "transition-verdict" && <div className="review-transition-note"><span className="review-pulse" />對話已完成，準備進入固定點評</div>}{speaking && <div className="review-turn-controls"><button className="review-continue-button" onClick={moveNext}>{nextLabel}<span>→</span></button><button className={`review-auto-toggle ${autoPlay ? "active" : ""}`} onClick={() => { setAutoPlay((value) => !value); setRemaining(countdownSeconds); }}>{autoPlay ? "暫停倒數" : "開啟倒數自動"}</button><small>{autoPlay ? `時間到自動進入下一句；目前每句 ${countdownSeconds} 秒` : "你可以閱讀完，再按繼續"}</small></div>}{phase === "verdict" && <div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button></div>}</section>;
}

function ArgumentBubble({ side, label, title, text, error }: { side: "positive" | "negative"; label: string; title: string; text: string; error?: boolean }) {
  return <details className={`review-argument-bubble ${side}`} open><summary className="review-argument-summary"><span>{side === "positive" ? "師" : "霸"}</span><div><b>{title}</b><small>{label}</small></div><i>{side === "positive" ? "TEACHER" : "SCHOLAR"}<em className="review-bubble-open">收合</em><em className="review-bubble-closed">展開</em></i></summary><div className="review-argument-content"><p className={error ? "error" : ""}>{text}</p><footer><span>問題定位</span><span>規範依據</span><span>個案涵攝</span></footer></div></details>;
}
