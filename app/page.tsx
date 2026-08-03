"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "./listening-player";

type Message = { role: "mentor" | "student"; text: string; sources?: string[] };
type ReplyUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsd: number };
type TodayTask = { id: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type DashboardData = { targetLabel: string; monthsRemaining: number; officialDatePending: boolean; todayProgress: { completed: number; total: number; delayed?: number; records?: number; correct?: number; answered?: number }; record: { completedTasks: number; completedMinutes: number; totalTasks: number }; priorities: Array<{ topic: string; count: number; reason: string }>; memo: string; encouragement: string };
type CropPoint = { x: number; y: number };
type ImageDraft = { url: string; name: string; points: CropPoint[]; rotation: number; enhance: boolean };
type PracticeQuestion = { id: number; examType: "mcq" | "essay"; year: string; subject: string; questionNumber: string; stem: string; options: Record<string, string> | null };
type MagazineArticle = { id: number; title: string; summary: string; reviewStatus: string; sequence: number };
type HomeFeed = { book: { id: number; title: string; creator: string; hasCover?: number } | null; course: { id: number; title: string; creator: string; sourceUrl: string } | null; magazine: { id: number; title: string; sourceUrl: string; description?: string; articles?: MagazineArticle[] } | null; listening: ListeningFeed | null; focusMusicUrl?: string; recommended: Array<{ id: number; resourceId: number; title: string; summary: string; startSeconds: number; importance: number }>; ticker: string[] };

const quickStarts = ["帶我開始今天的刑法", "我想練一題司律真題", "幫我複習不作為犯"];
function cleanMessageText(text: string) { return text.replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1"); }
function isLearningNote(text: string) { const clean = cleanMessageText(text); if (clean.length < 80) return false; if (/尚未匯入|尚未準備|暫時無法|沒有連上|API|錯誤|請稍後|管理者/.test(clean)) return false; return /法條|爭點|要件|涵攝|解題|判斷|原則|例外|學說|實務|教材|刑法|民法|訴訟法|憲法|行政法/.test(clean); }
function youtubeId(value: string) { try { const url = new URL(value); const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? ""); return id.split(/[?&]/)[0]; } catch { return ""; } }
function youtubeEmbedUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1` : ""; }
function youtubeWatchUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : ""; }
function dateLabel(value: string) { return value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日") : "今天"; }

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [weekTasks, setWeekTasks] = useState<TodayTask[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [today, setToday] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [railSide, setRailSide] = useState<"left" | "right">("right");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [source, setSource] = useState<"教材" | "AI 補充" | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [lastUsage, setLastUsage] = useState<ReplyUsage | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [editingImage, setEditingImage] = useState(false);
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestion | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState<{ selected: string; correct: boolean; correctAnswer: string } | null>(null);
  const [savedMessage, setSavedMessage] = useState<number | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<number | null>(null);
  const handoffHandled = useRef(false);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    fetch("/api/chat/history").then(async (response) => {
      if (!response.ok) throw new Error("history unavailable");
      const data = await response.json() as { sessionId?: number | null; messages?: Message[]; today?: string; todayTasks?: TodayTask[] };
      setSessionId(data.sessionId ?? null);
      setToday(data.today ?? "");
      setTodayTasks(data.todayTasks ?? []);
      const restored = data.messages ?? [];
      if (restored.length) setMessages(restored);
      else if ((data.todayTasks ?? []).length) {
        const pending = (data.todayTasks ?? []).filter((task) => task.status !== "completed");
        setMessages([{ role: "mentor", text: pending.length ? `早安，今天已經安排好 ${pending.length} 項任務。我們從第一項「${pending[0].title}」開始，好嗎？` : "今天的任務都完成了。要不要趁狀態正好，先預習明天的內容？" }]);
      } else {
        setMessages([{ role: "mentor", text: "早安，我是司律備考的 AI 教練。今天還沒有安排任務，我可以先根據你的目標與可用時間，幫你建立第一份學習計畫。" }]);
      }
    }).catch(() => {
      setMessages([{ role: "mentor", text: "早安，我是司律備考的 AI 教練。今天想從哪一科開始？" }]);
    }).finally(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => { fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed(await response.json() as HomeFeed); }).catch(() => undefined); }, []);

  useEffect(() => {
    fetch("/api/dashboard").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as DashboardData;
      setDashboard(data);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!today) return;
    fetch(`/api/study-plan?month=${today.slice(0, 7)}`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { tasks?: TodayTask[] };
      setWeekTasks(data.tasks ?? []);
    }).catch(() => undefined);
  }, [today]);

  useEffect(() => {
    fetch("/api/usage").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { showCosts?: boolean };
      setShowCosts(Boolean(data.showCosts));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("silu-command-rail-side");
    if (saved === "left" || saved === "right") setRailSide(saved);
  }, []);

  function toggleRailSide() {
    const next = railSide === "right" ? "left" : "right";
    setRailSide(next);
    window.localStorage.setItem("silu-command-rail-side", next);
  }

  async function startPractice(examType: "mcq" | "essay") {
    setPracticeLoading(true); setPracticeAnswer(null);
    try {
      const response = await fetch(`/api/practice?type=${examType}`); const result = await response.json() as { question?: PracticeQuestion | null; message?: string };
      if (result.question) setPracticeQuestion(result.question);
      else { setPracticeQuestion(null); setMessages((current) => [...current, { role: "mentor", text: result.message ?? "真題庫尚未準備完成。管理者匯入並確認題目後，我就能從這裡開始帶你練習。" }]); }
    } finally { setPracticeLoading(false); }
  }

  function askMagazineArticle(article: MagazineArticle) {
    void send(`請帶我學習月旦法學教室的文章「${article.title}」。這是後台已分析的試讀摘要：${article.summary || "目前沒有摘要，請先從文章標題辨認可能的司律考點。"}\n請先說明這篇內容可能對應的司律爭點，再問我一個可以直接回答的小問題。`);
  }

  async function answerMcq(answer: string) {
    if (!practiceQuestion || practiceAnswer) return;
    const response = await fetch("/api/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: practiceQuestion.id, answer }) });
    const result = await response.json() as { correct?: boolean; correctAnswer?: string; guidance?: string; error?: string };
    if (!response.ok || typeof result.correct !== "boolean" || !result.correctAnswer) return;
    setPracticeAnswer({ selected: answer, correct: result.correct, correctAnswer: result.correctAnswer });
    setMessages((current) => [...current, { role: "mentor", text: result.guidance ?? "先說說你的判斷理由，我們再逐一檢查其他選項。" }]);
  }

  function chooseQuestionImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { setImageDraft({ url: String(reader.result), name: file.name, rotation: 0, enhance: false, points: [{ x: 4, y: 4 }, { x: 50, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 50, y: 96 }, { x: 4, y: 96 }] }); setEditingImage(true); };
    reader.readAsDataURL(file);
  }

  function moveCropPoint(index: number, clientX: number, clientY: number) {
    const rect = editorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100)) };
    setImageDraft((current) => current ? { ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? point : item) } : current);
  }

  async function prepareQuestionImage(draft: ImageDraft) {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = draft.url; });
    const xs = draft.points.map((point) => point.x / 100 * source.naturalWidth);
    const ys = draft.points.map((point) => point.y / 100 * source.naturalHeight);
    const minX = Math.max(0, Math.min(...xs)); const maxX = Math.min(source.naturalWidth, Math.max(...xs));
    const minY = Math.max(0, Math.min(...ys)); const maxY = Math.min(source.naturalHeight, Math.max(...ys));
    const cropWidth = Math.max(1, maxX - minX); const cropHeight = Math.max(1, maxY - minY);
    const scale = Math.min(1, 1600 / Math.max(cropWidth, cropHeight));
    const cropped = document.createElement("canvas"); cropped.width = Math.round(cropWidth * scale); cropped.height = Math.round(cropHeight * scale);
    const context = cropped.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, cropped.width, cropped.height); context.save(); context.beginPath();
    draft.points.forEach((point, index) => { const x = (point.x / 100 * source.naturalWidth - minX) * scale; const y = (point.y / 100 * source.naturalHeight - minY) * scale; index ? context.lineTo(x, y) : context.moveTo(x, y); });
    context.closePath(); context.clip(); context.filter = draft.enhance ? "contrast(1.28) brightness(1.06) saturate(.82)" : "none"; context.drawImage(source, -minX * scale, -minY * scale, source.naturalWidth * scale, source.naturalHeight * scale); context.restore();
    const turns = ((draft.rotation % 360) + 360) % 360; if (!turns) return cropped.toDataURL("image/jpeg", .78);
    const rotated = document.createElement("canvas"); const swap = turns === 90 || turns === 270; rotated.width = swap ? cropped.height : cropped.width; rotated.height = swap ? cropped.width : cropped.height;
    const rotatedContext = rotated.getContext("2d")!; rotatedContext.fillStyle = "white"; rotatedContext.fillRect(0, 0, rotated.width, rotated.height); rotatedContext.translate(rotated.width / 2, rotated.height / 2); rotatedContext.rotate(turns * Math.PI / 180); rotatedContext.drawImage(cropped, -cropped.width / 2, -cropped.height / 2);
    return rotated.toDataURL("image/jpeg", .78);
  }

  async function send(text: string) {
    const value = text.trim();
    if ((!value && !imageDraft) || thinking) return;
    const question = value || "請先辨識這張圖片中的題目，帶我一步一步審題。";
    const attachedImage = imageDraft ? await prepareQuestionImage(imageDraft) : undefined;
    const nextMessages: Message[] = [...messages, { role: "student", text: imageDraft ? `📷 ${question}` : question }];
    setMessages(nextMessages);
    setInput("");
    setImageDraft(null);
    setEditingImage(false);
    setThinking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12), sessionId, imageDataUrl: attachedImage }),
      });
      const result = await response.json() as { reply?: string; source?: "教材" | "AI 補充"; sources?: string[]; usage?: ReplyUsage; sessionId?: number; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "對話暫時無法使用");
      setMessages((current) => [...current, { role: "mentor", text: result.reply!, sources: result.sources ?? [] }]);
      setSource(result.source ?? "AI 補充");
      setLastUsage(result.usage ?? null);
      if (result.sessionId) setSessionId(result.sessionId);
    } catch {
      setMessages((current) => [...current, {
        role: "mentor",
        text: "我現在還沒有連上伺服器端的 AI Key。你可以先繼續告訴我想學的科目；管理者完成環境設定後，我會從這裡接著帶你學。",
      }]);
    } finally {
      setThinking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  useEffect(() => {
    if (!historyLoaded || handoffHandled.current) return;
    const prompt = new URLSearchParams(window.location.search).get("prompt")?.trim();
    if (!prompt) return;
    handoffHandled.current = true;
    window.history.replaceState({}, "", "/");
    void send(prompt);
  }, [historyLoaded]);

  async function saveMessageNote(message: Message, index: number) {
    const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceType: "conversation", sourceId: sessionId ? `${sessionId}-${index}` : String(index), title: cleanMessageText(message.text).slice(0, 32), content: cleanMessageText(message.text), subject: todayTasks.find((task) => task.status !== "completed")?.subject ?? "綜合", tags: "AI對話", sourceLabel: message.sources?.join("、") ?? "" }) });
    if (response.ok) { setSavedMessage(index); window.setTimeout(() => setSavedMessage(null), 1600); }
  }

  async function sendFeedback(message: Message, index: number, feedbackType: "helpful" | "incorrect" | "not_learning" | "unclear") {
    const response = await fetch("/api/chat/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, messageIndex: index, feedbackType, messageText: cleanMessageText(message.text) }) });
    if (response.ok) { setFeedbackMessage(index); window.setTimeout(() => setFeedbackMessage(null), 1600); }
  }

  return (
    <main className="coach-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="司律備考首頁">
          <span className="brand-mark">律</span>
          <span>司律備考</span>
        </Link>
        <div className="top-actions">
          <span className="knowledge-state"><i /> 教材知識庫準備中</span>
          <Link href="/plan" className="admin-link">學習專區</Link>
          <Link href="/admin" className="admin-link">管理後台</Link>
        </div>
      </header>
      <div className="study-ticker" aria-label="司律作戰快訊"><strong>作戰快訊</strong><div><span>{(homeFeed?.ticker ?? ["距離目標再前進一小步"]).join("　◆　")}</span></div></div>

      <section className="home-pulse" aria-label="今日備考資訊">
        <div className="pulse-date"><span>今天日期</span><strong>{dateLabel(today)}</strong><small>司律備考每日同步</small></div>
      </section>

      <div className={`command-layout rail-${railSide}`}>
      <section className="conversation" aria-live="polite">
        <div className="conversation-heading">
          <p>AI 司律作戰中心</p>
          <h1>今天，照計畫前進。</h1>
          <span>我會讀取你的計畫、進度與教材，接著上次的地方帶你學。</span>
        </div>
        {practiceQuestion && <section className="practice-card"><div className="practice-meta"><span>{practiceQuestion.examType === "mcq" ? "一試選擇題" : "二試申論題"}</span><strong>{practiceQuestion.year} · {practiceQuestion.subject} · 第 {practiceQuestion.questionNumber} 題</strong><button onClick={() => setPracticeQuestion(null)}>收起</button></div><p className="practice-stem">{practiceQuestion.stem}</p>{practiceQuestion.examType === "mcq" && practiceQuestion.options ? <div className="option-grid">{["A", "B", "C", "D"].filter((key) => practiceQuestion.options?.[key]).map((key) => { const selected = practiceAnswer?.selected === key; const correct = practiceAnswer?.correctAnswer === key; return <button className={`${selected ? "selected" : ""} ${practiceAnswer && correct ? "correct" : ""} ${practiceAnswer && selected && !practiceAnswer.correct ? "wrong" : ""}`} disabled={Boolean(practiceAnswer)} onClick={() => answerMcq(key)} key={key}><b>{key}</b><span>{practiceQuestion.options?.[key]}</span></button>; })}</div> : <button className="essay-start" onClick={() => { const question = practiceQuestion; setPracticeQuestion(null); send(`請用申論題審題方式帶我分析這題；先從人物、行為、時間與法律關係開始提問，不要直接給完整答案：\n${question.stem}`); }}>開始學審題</button>}{practiceAnswer && <div className={`answer-result ${practiceAnswer.correct ? "correct" : "wrong"}`}><strong>{practiceAnswer.correct ? "答對了" : "再想一步"}</strong><span>正確答案：{practiceAnswer.correctAnswer}。完整解析暫不展開，先回答導師接下來的問題。</span></div>}</section>}

        {todayTasks.length > 0 && <details className="today-plan-card">
          <summary><div><b>今日任務</b><span>{todayTasks.filter((task) => task.status === "completed").length}/{todayTasks.length} 完成 · {todayTasks.find((task) => task.status !== "completed")?.title ?? "今日任務已完成"}</span></div><em>展開</em></summary>
          <div className="today-plan-head"><div><p>今日學習計畫</p><strong>{today || "今天"}</strong></div><Link href="/plan">查看行事曆 →</Link></div>
          <div className="today-task-list">{todayTasks.map((task) => <div className={`today-task ${task.status === "completed" ? "done" : ""}`} key={task.id}><span>{task.status === "completed" ? "✓" : ""}</span><div><strong>{task.subject} · {task.title}</strong><small>{task.durationMinutes} 分鐘{task.details ? ` · ${task.details}` : ""}</small></div></div>)}</div>
          {todayTasks.some((task) => task.status !== "completed") && <button onClick={() => send(`請直接帶我開始今天第一個尚未完成的任務：${todayTasks.find((task) => task.status !== "completed")?.title}`)}>開始今日第一項</button>}
        </details>}

        <div className="message-list" ref={messageListRef}>
          {!historyLoaded && <div className="message-row mentor"><span className="mentor-avatar">律</span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === "mentor" && <span className="mentor-avatar">律</span>}
              <div className="message-bubble"><span className="message-text">{cleanMessageText(message.text)}</span>{message.role === "mentor" && message.sources?.length ? <small className="message-sources">教材來源：{message.sources.join("、")}</small> : null}{message.role === "mentor" && <div className="message-actions">{isLearningNote(message.text) && <button className="save-note-button" onClick={() => saveMessageNote(message, index)}>{savedMessage === index ? "已收藏 ✓" : "收藏筆記"}</button>}<details className="feedback-menu"><summary>{feedbackMessage === index ? "已收到 ✓" : "回饋"}</summary><div><button onClick={() => sendFeedback(message, index, "helpful")}>有幫助</button><button onClick={() => sendFeedback(message, index, "incorrect")}>內容有誤</button><button onClick={() => sendFeedback(message, index, "unclear")}>不夠清楚</button><button onClick={() => sendFeedback(message, index, "not_learning")}>非學習內容</button></div></details></div>}</div>
            </div>
          ))}
          {thinking && (
            <div className="message-row mentor">
              <span className="mentor-avatar">律</span>
              <div className="message-bubble typing"><i /><i /><i /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {source && <div className="answer-source">本次回答：{source === "教材" ? "依平台教材整理" : "平台教材未命中，使用 AI 一般知識補充"}{showCosts && lastUsage ? <span className="frontend-cost"> · {lastUsage.model.replace("gpt-5.6-", "")} · {lastUsage.inputTokens + lastUsage.outputTokens} tokens · US$ {lastUsage.estimatedCostUsd.toFixed(5)}</span> : null}</div>}

        {historyLoaded && messages.length === 1 && (
          <div className="quick-starts">
            {quickStarts.map((item) => (
              <button key={item} onClick={() => send(item)}>{item}</button>
            ))}
          </div>
        )}
      </section>

      <aside className="command-rail">
        <button className="rail-switch" onClick={toggleRailSide} aria-label={`將作戰資訊移到${railSide === "right" ? "左" : "右"}側`}>⇆ 移到{railSide === "right" ? "左邊" : "右邊"}</button>
        <section className="rail-card rail-practice"><div className="rail-title"><strong>練真題</strong><span>在對話中引導</span></div><div><button onClick={() => startPractice("mcq")} disabled={practiceLoading}>一試選擇題</button><button onClick={() => startPractice("essay")} disabled={practiceLoading}>二試申論題</button></div></section>
        <article className="home-editorial-card rail-editorial-card"><div className="column-kicker">LISTENING SOLUTION</div><div className="home-editorial-head"><div><h2>聽解題專區</h2><span>{homeFeed?.listening ? `${homeFeed.listening.year} · ${homeFeed.listening.subject}` : "把解題變成可以反覆聽的學習段落"}</span></div><i>{homeFeed?.listening ? "▶" : "聽"}</i></div>{homeFeed?.listening ? <><p>先聽老師抓爭點，再回學習專區接續今天的題目。</p><ListeningPlayer item={homeFeed.listening} compact /></> : <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>}</article>
        <article className="home-editorial-card rail-editorial-card"><div className="column-kicker">LAW CLASSROOM</div><div className="home-editorial-head"><div><h2>法教專區</h2><span>最新法學教室內容的司律切入點</span></div><i>法</i></div>{homeFeed?.magazine ? <><strong>{homeFeed.magazine.title}</strong><div className="magazine-article-list">{(homeFeed.magazine.articles ?? []).map((article) => <div className="magazine-article-row" key={article.id}><span>{article.title}</span><button type="button" onClick={() => askMagazineArticle(article)}>AI 帶入</button></div>)}</div><a href={homeFeed.magazine.sourceUrl} target="_blank" rel="noreferrer">查看法學教室來源 →</a></> : <p className="column-empty">後台匯入並發布法學教室試讀內容後，最新專區會出現在這裡。</p>}</article>
        <section className="rail-card home-weekly-focus"><div className="rail-title"><strong>本週 AI 重點課程</strong><Link href="/plan">查看 →</Link></div>{weekTasks.length ? weekTasks.slice(0, 4).map((task) => <div className="home-focus-row" key={task.id}><time>{task.taskDate.slice(5).replace("-", "/")}</time><span>{task.subject} · {task.title}</span></div>) : <p className="rail-empty">AI 排定的本週重點會隨學習計畫出現在這裡。</p>}</section>
        <article className="home-editorial-card rail-editorial-card rail-music-card"><div className="column-kicker">FOCUS MUSIC</div><div className="home-editorial-head"><div><h2>讀書音樂</h2><span>需要時再開啟，不干擾今日學習</span></div><i>♫</i></div>{youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "") ? <><iframe title="司律備考讀書音樂" src={youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "")} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" /><a className="music-open-link" href={youtubeWatchUrl(homeFeed?.focusMusicUrl ?? "")} target="_blank" rel="noreferrer">在 YouTube 開啟 ↗</a></> : <p className="column-empty">管理後台設定讀書音樂後，會在這裡提供播放。</p>}</article>
      </aside>
      </div>

      <div className={`composer-wrap rail-${railSide}`}>
        {imageDraft && !editingImage && <div className="image-ready"><button className="image-ready-preview" onClick={() => setEditingImage(true)} aria-label="再次編輯圖片"><img src={imageDraft.url} alt="待送出的題目圖片" /></button><span>{imageDraft.name}<small>已準備，點圖片可再調整</small></span><button onClick={() => setImageDraft(null)} aria-label="移除圖片">×</button></div>}
        <form className="composer" onSubmit={submit} onPaste={(event) => { const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile(); if (image) { event.preventDefault(); chooseQuestionImage(new File([image], `貼上的題目-${Date.now()}.png`, { type: image.type })); } }}>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { chooseQuestionImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <button className="attach-image" type="button" aria-label="上傳或貼上圖片問問題" title="上傳圖片，也可直接按 Ctrl+V 貼上" onClick={() => imageInputRef.current?.click()}>＋</button>
          <textarea
            aria-label="輸入你想學習的內容"
            placeholder="告訴我你想學什麼，或直接貼上一道題目……"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={1}
          />
          <button className="send-button" type="submit" aria-label="送出" disabled={(!input.trim() && !imageDraft) || thinking}>↑</button>
        </form>
        <p>教材優先檢索 · 找不到時由 AI 補充並清楚標示</p>
      </div>

      {imageDraft && editingImage && <div className="image-editor-backdrop" role="dialog" aria-modal="true" aria-label="編輯題目圖片"><section className="image-editor"><div className="image-editor-head"><div><strong>調整題目圖片</strong><span>拖曳六個控制點，保留要詢問的範圍</span></div><button onClick={() => setImageDraft(null)} aria-label="關閉">×</button></div><div className={`crop-stage ${imageDraft.enhance ? "enhanced" : ""}`} ref={editorRef}><img src={imageDraft.url} alt="圖片裁切預覽" style={{ transform: `rotate(${imageDraft.rotation}deg)` }} />{imageDraft.points.map((point, index) => <button key={index} className="crop-handle" style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`裁切控制點 ${index + 1}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveCropPoint(index, event.clientX, event.clientY); }} />)}</div><div className="image-tools"><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation - 90 } : current)}>↶ 左轉</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation + 90 } : current)}>↷ 右轉</button><button className={imageDraft.enhance ? "active" : ""} onClick={() => setImageDraft((current) => current ? { ...current, enhance: !current.enhance } : current)}>✦ 加強圖片</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: 0, enhance: false, points: [{ x: 4, y: 4 }, { x: 50, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 50, y: 96 }, { x: 4, y: 96 }] } : current)}>重設</button></div><div className="image-editor-actions"><button className="secondary" onClick={() => setImageDraft(null)}>取消</button><button onClick={() => setEditingImage(false)}>使用這張圖片</button></div><p>送出時自動縮至最長邊 1600px，並壓縮為 JPEG。</p></section></div>}
    </main>
  );
}
