"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Provider = "luna" | "sonnet" | "deepseek";
type DebateMode = "manual" | "countdown";
type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; hasTeacherAnswer?: boolean; answerSource?: string };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number };
type ModelRun = { model: string; text: string; usage?: Usage };
type ReviewResult = { question: Question; models: { positive: string; negative: string; commentator: string }; positive: ModelRun | null; negative: ModelRun | null; positiveError?: string | null; negativeError?: string | null; commentator: ModelRun | null; commentatorError?: string };

const modelLabels: Record<Provider, string> = { luna: "Luna", sonnet: "Claude Sonnet", deepseek: "DeepSeek V4-Pro" };
const modelNotes: Record<Provider, string> = { luna: "反應快｜適合白話拆題", sonnet: "結構穩｜適合完整攻防", deepseek: "成本低｜適合大量測試" };

function stars(value: number) { return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value); }

export default function ReviewPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [positiveModel, setPositiveModel] = useState<Provider>("luna");
  const [negativeModel, setNegativeModel] = useState<Provider>("sonnet");
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
      setQuestions(data.questions ?? []);
      setQuestion(data.question ?? null);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const questionMeta = useMemo(() => question ? `${question.year}｜${question.subject}｜第${question.questionNumber}題` : "尚未選擇題目", [question]);

  async function startDebate() {
    if (!question || running) return;
    setRunning(true); setResult(null); setDebateCompleted(false); setActivePanel("debate"); setSavedComment("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, positiveModel, negativeModel }) });
      const data = await response.json() as ReviewResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "司律評暫時無法開始");
      setResult(data);
    } catch (error) {
      setResult({ question, models: { positive: modelLabels[positiveModel], negative: modelLabels[negativeModel], commentator: "Sol" }, positive: null, negative: null, commentator: null, positiveError: error instanceof Error ? error.message : "暫時無法開始", negativeError: null, commentatorError: "" });
    } finally { setRunning(false); }
  }

  function saveStudentView() {
    if (!rating && !comment.trim()) return;
    setSavedComment(`已記錄：${rating ? `學習評分 ${rating} 分` : ""}${rating && comment.trim() ? "｜" : ""}${comment.trim() || "沒有補充意見"}`);
    window.localStorage.setItem(`silu-review-feedback-${question?.id ?? "current"}`, JSON.stringify({ rating, comment: comment.trim(), updatedAt: new Date().toISOString() }));
  }

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <Link href="/" className="review-brand" aria-label="回到司律備考"><span className="review-mark">評</span><span><b>司律評</b><small>看懂一題，學會怎麼答</small></span></Link>
        <nav aria-label="司律評導覽"><a className="active" href="#battle">攻防觀戰</a><a href="#model-pk">模型 PK</a><a href="#expert">專業點評</a><Link href="/">回司律備考</Link></nav>
      </header>

      <section className="review-hero">
        <div className="review-hero-copy"><p className="review-kicker">THE LAWYER DEBATE ROOM</p><h1>同一題，<em>兩種立場</em>，<br />看見真正的答題差距。</h1><p>學生先當觀眾。選擇正反方模型，看它們如何抓爭點、拆規範、做涵攝，最後交給固定的 Sol 點評。</p><div className="review-hero-actions"><a href="#battle" className="review-primary">開始一場攻防 <span>↘</span></a><span className="review-status-dot"><i />共用司律備考真題與教材</span></div></div>
        <div className="review-seal" aria-hidden="true"><span>司</span><strong>律</strong><b>評</b></div>
        <div className="review-hero-lines" aria-hidden="true"><i /><i /><i /></div>
      </section>

      <section className="review-workspace" id="battle">
        <aside className="review-sidebar"><div className="review-side-title"><span>今日觀戰</span><b>{questions.length ? `${questions.length} 題可選` : "題庫同步中"}</b></div><div className="review-filter"><label>選擇歷屆題目<select value={question?.id ?? ""} onChange={(event) => { const next = questions.find((item) => item.id === Number(event.target.value)); if (next) { setQuestion(next); setResult(null); setDebateCompleted(false); setActivePanel("question"); } }} disabled={!questions.length}><option value="">{loading ? "讀取已發布題目…" : questions.length ? "請選擇題目" : "尚無已發布申論題"}</option>{questions.map((item) => <option value={item.id} key={item.id}>{item.year}｜{item.subject}｜第{item.questionNumber}題</option>)}</select></label></div><div className="review-steps"><button className={activePanel === "question" ? "active" : ""} onClick={() => setActivePanel("question")}><b>01</b><span>先讀題目<small>確認攻防事實</small></span></button><button className={activePanel === "debate" ? "active" : ""} onClick={() => setActivePanel("debate")}><b>02</b><span>逐回合對話<small>一來一往看攻防</small></span></button><button className={activePanel === "verdict" ? "active" : ""} onClick={() => setActivePanel("verdict")}><b>03</b><span>聽固定點評<small>Sol 整理考場寫法</small></span></button></div><div className="review-side-note"><span>司律評的核心</span><p>不是一次看完答案，而是跟著一來一往的攻防，找出誰漏掉了爭點、規範與涵攝。</p></div></aside>

        <div className="review-main"><div className="review-main-head"><div><p>{questionMeta}</p><h2>{activePanel === "question" ? "先讀題目，再決定誰來辯" : activePanel === "debate" ? "逐回合對話" : "固定點評人的判斷"}</h2></div><span className="review-confidential">資料依據 <b>{question?.hasTeacherAnswer ? "已連結老師擬答" : "題目資料已連結"}</b></span></div>

          {activePanel === "question" && <section className="review-question-card"><div className="review-question-label"><span>CASE FILE</span><b>{question?.hasTeacherAnswer ? "題目＋老師擬答" : "正式題目"}</b></div>{question ? <><h3>{question.stem.slice(0, 220)}{question.stem.length > 220 ? "…" : ""}</h3><details><summary>展開完整題目</summary><p>{question.stem}</p></details><div className="review-source-row"><span>來源：司律備考已發布題庫</span>{question.answerSource ? <span>核對：{question.answerSource}</span> : <span>老師擬答：尚未連結</span>}</div></> : <div className="review-empty">{loading ? "正在從司律備考讀取已發布的二試題目…" : "目前沒有已發布的二試申論題。請先在管理後台完成題目發布。"}</div>}</section>}

          {activePanel === "question" && <section className="review-model-stage" id="model-pk"><div className="review-section-heading"><div><span>BEFORE THE BATTLE</span><h3>先安排兩位辯手</h3></div><p>正反方可以換模型；點評人固定使用 Sol。開始後不會一次攤開答案，而是由點評人逐回合串場。</p></div><div className="review-model-pickers"><ModelPicker tone="positive" title="甲方／正方模型" subtitle="主張成立／提出完整論證" value={positiveModel} onChange={setPositiveModel} /><div className="review-versus">VS</div><ModelPicker tone="negative" title="乙方／反方模型" subtitle="找漏洞／提出替代涵攝" value={negativeModel} onChange={setNegativeModel} /></div><div className="review-fixed-judge"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人｜GPT-5.6 Sol</b><small>負責宣布誰發言、串接回合、比較內容、指出漏答與整理考場防呆筆記</small></div><i>LOCKED</i></div><div className="review-watch-settings"><div><b>觀戰方式</b><small>甲方回答後，決定要自己按繼續，或讓攻防自動往下走。</small></div><div className="review-watch-mode"><button type="button" className={debateMode === "manual" ? "selected" : ""} onClick={() => setDebateMode("manual")}>手動繼續</button><button type="button" className={debateMode === "countdown" ? "selected" : ""} onClick={() => setDebateMode("countdown")}>倒數自動</button></div>{debateMode === "countdown" && <label className="review-countdown-select">回答間隔<select value={countdownSeconds} onChange={(event) => setCountdownSeconds(Number(event.target.value))}><option value={15}>15 秒</option><option value={20}>20 秒</option><option value={30}>30 秒</option><option value={45}>45 秒</option></select></label>}</div><button className="review-start-button" onClick={() => void startDebate()} disabled={!question || running}>{running ? <><span className="review-spinner" />正在準備第一回合…</> : <>開始一場對話式攻防 <span>→</span></>}</button></section>}

          {activePanel !== "question" && <DebatePanel result={result} running={running} panel={activePanel} mode={debateMode} countdownSeconds={countdownSeconds} onGoQuestion={() => setActivePanel("question")} onComplete={() => setDebateCompleted(true)} />}

          {result && !running && debateCompleted && <section className="review-feedback" id="student-feedback"><div><span className="review-feedback-kicker">YOUR VIEW</span><h3>換你評這一場</h3><p>AI 點評是法律品質判斷；你的評分，代表這一場對考生是否真的有幫助。</p></div><div className="review-rating"><span>學習實用度</span><button aria-label="評分 1 分" onClick={() => setRating(1)}>{stars(1)}</button><div className="review-rating-buttons">{[1, 2, 3, 4, 5].map((item) => <button key={item} className={rating === item ? "selected" : ""} onClick={() => setRating(item)}>{item}</button>)}</div></div><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="哪一方比較有說服力？哪個爭點你還想追問？" rows={3} /><button className="review-save-feedback" onClick={saveStudentView}>送出我的看法</button>{savedComment && <small className="review-saved-feedback">{savedComment}</small>}</section>}
        </div>
      </section>

      <footer className="review-footer"><span>司律評</span><p>一題一場攻防，讓你看見申論題真正的得分差距。</p><Link href="/plan">從觀戰銜接到練真題 →</Link></footer>
    </main>
  );
}

function ModelPicker({ tone, title, subtitle, value, onChange }: { tone: "positive" | "negative"; title: string; subtitle: string; value: Provider; onChange: (value: Provider) => void }) {
  return <label className={`review-model-picker ${tone}`}><div className="review-picker-top"><span>{tone === "positive" ? "正" : "反"}</span><b>{title}</b></div><select value={value} onChange={(event) => onChange(event.target.value as Provider)}>{Object.entries(modelLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><small>{modelNotes[value]}｜{subtitle}</small></label>;
}

function DebatePanel({ result, running, panel, mode, countdownSeconds, onGoQuestion, onComplete }: { result: ReviewResult | null; running: boolean; panel: "debate" | "verdict"; mode: DebateMode; countdownSeconds: number; onGoQuestion: () => void; onComplete: () => void }) {
  const [phase, setPhase] = useState<"positive" | "transition-negative" | "negative" | "transition-verdict" | "verdict">("positive");
  const [remaining, setRemaining] = useState(countdownSeconds);
  const [autoPlay, setAutoPlay] = useState(mode === "countdown");

  useEffect(() => {
    if (!result) return;
    setPhase("positive");
    setRemaining(countdownSeconds);
    setAutoPlay(mode === "countdown");
  }, [result, countdownSeconds, mode]);

  useEffect(() => {
    if (!result || (phase !== "positive" && phase !== "negative") || !autoPlay) return;
    setRemaining(countdownSeconds);
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    const advance = window.setTimeout(() => moveNext(), countdownSeconds * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(advance); };
    // moveNext is intentionally the stable state-machine action for this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoPlay, result, countdownSeconds]);

  useEffect(() => {
    if (phase !== "transition-negative" && phase !== "transition-verdict") return;
    const timer = window.setTimeout(() => setPhase(phase === "transition-negative" ? "negative" : "verdict"), 1300);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "verdict") onComplete();
  }, [phase, onComplete]);

  function moveNext() {
    setRemaining(countdownSeconds);
    if (phase === "positive") setPhase("transition-negative");
    else if (phase === "negative") setPhase("transition-verdict");
  }

  if (running) return <section className="review-live-stage"><div className="review-live-orbit"><span>甲</span><b>↔</b><span>乙</span></div><h3>點評人正在準備第一回合</h3><p>兩位辯手先各自讀取同一題與核對資料；完成後會由甲方先發言。</p><div className="review-loading-bar"><i /></div></section>;
  if (!result) return <section className="review-live-stage"><div className="review-no-result"><b>尚未開始觀戰</b><span>回到第一步選擇題目與模型。</span><button onClick={onGoQuestion}>回到安排頁</button></div></section>;

  const positiveText = result.positive?.text || result.positiveError || "甲方尚未產生內容。";
  const negativeText = result.negative?.text || result.negativeError || "乙方尚未產生內容。";
  const isPositive = phase === "positive";
  const isNegative = phase === "negative";
  const isTransition = phase === "transition-negative" || phase === "transition-verdict";
  const title = phase === "positive" ? "甲方先回答" : phase === "negative" ? "乙方請回答" : phase === "verdict" ? "點評人的判斷" : "點評人串場中";
  const notice = phase === "positive" ? "請甲方先就題目提出主張。" : phase === "negative" ? "甲方陳述完成，請乙方回應。" : phase === "transition-negative" ? "甲方回答完成，下一位是乙方。" : phase === "transition-verdict" ? "雙方第一回合完成，接下來由固定點評人整理。" : "現在回看雙方如何抓爭點、規範與涵攝。";

  return <section className="review-conversation-stage"><div className="review-round-label"><span>ROUND 01｜逐回合攻防</span><i />{phase === "verdict" ? "點評已完成" : autoPlay ? "倒數自動進行中" : "由你決定何時繼續"}</div><div className="review-conversation-head"><div><span className="review-conversation-live"><i />LIVE DEBATE</span><h3>{title}</h3><p>{notice}</p></div>{(isPositive || isNegative) && <div className={`review-countdown ${remaining <= 5 ? "urgent" : ""}`} aria-label={`剩餘 ${remaining} 秒`}><b>{autoPlay ? remaining : "—"}</b><small>{autoPlay ? "秒後繼續" : "手動模式"}</small></div>}</div><div className="review-chat-thread"><div className="review-judge-line"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>{notice}</p></div>{(isPositive || phase === "transition-negative" || phase === "negative" || phase === "transition-verdict" || phase === "verdict") && <ArgumentBubble side="positive" label={result.models.positive} title="甲方／正方" text={positiveText} error={Boolean(result.positiveError && !result.positive?.text)} />}{isTransition && <div className="review-judge-line active"><span className="review-judge-badge">S</span><p><b>點評人 Sol</b>{notice}</p></div>}{(isNegative || phase === "transition-verdict" || phase === "verdict") && <ArgumentBubble side="negative" label={result.models.negative} title="乙方／反方" text={negativeText} error={Boolean(result.negativeError && !result.negative?.text)} />}{phase === "verdict" && <div className="review-commentator-card featured"><div className="review-commentator-head"><span className="review-judge-badge">S</span><div><b>固定 AI 點評人</b><strong>{result.models.commentator}</strong></div><span className="review-expert-tag">POINT OF VIEW</span></div>{result.commentator?.text ? <p>{result.commentator.text}</p> : <div className="review-commentator-empty">{result.commentatorError || "固定點評暫時沒有可顯示內容。"}</div>}</div>}</div>{isTransition && <div className="review-transition-note"><span className="review-pulse" />{phase === "transition-negative" ? "甲方已回答，準備請乙方接話" : "攻防已完成，準備進入固定點評"}</div>}{(isPositive || isNegative) && <div className="review-turn-controls"><button className="review-continue-button" onClick={moveNext}>{isPositive ? "繼續，請乙方回答" : "繼續，聽點評人整理"}<span>→</span></button><button className={`review-auto-toggle ${autoPlay ? "active" : ""}`} onClick={() => { setAutoPlay((value) => !value); setRemaining(countdownSeconds); }}>{autoPlay ? "暫停倒數" : "開啟倒數自動"}</button><small>{autoPlay ? `時間到由 Sol 串場；目前每段 ${countdownSeconds} 秒` : "你可以閱讀完，再按繼續"}</small></div>}{phase === "verdict" && <div className="review-jump-actions"><button className="selected" onClick={() => document.getElementById("student-feedback")?.scrollIntoView({ behavior: "smooth" })}>看完點評，留下你的判斷</button></div>}</section>;
}

function ArgumentBubble({ side, label, title, text, error }: { side: "positive" | "negative"; label: string; title: string; text: string; error?: boolean }) {
  return <article className={`review-argument-bubble ${side}`}><header><span>{side === "positive" ? "甲" : "乙"}</span><div><b>{title}</b><small>{label}</small></div><i>{side === "positive" ? "PRO" : "CON"}</i></header><p className={error ? "error" : ""}>{text}</p><footer><span>爭點定位</span><span>規範依據</span><span>個案涵攝</span></footer></article>;
}
