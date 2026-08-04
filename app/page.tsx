"use client";

import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "./listening-player";
import { taipeiDate, taipeiGreeting } from "../lib/taipei-time";

type Message = { role: "mentor" | "student"; text: string; sources?: string[] };
type ReplyUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsd: number };
type TodayTask = { id: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type DashboardData = { targetLabel: string; monthsRemaining: number; officialDatePending: boolean; todayProgress: { completed: number; total: number; delayed?: number; records?: number; correct?: number; answered?: number }; record: { completedTasks: number; completedMinutes: number; totalTasks: number }; priorities: Array<{ topic: string; count: number; reason: string }>; memo: string; encouragement: string };
type TodayRecord = { subject: string; title: string; activityType: string; actualMinutes: number; nextStep: string };
type CropPoint = { x: number; y: number };
type ImageDraft = { url: string; name: string; points: CropPoint[]; rotation: number; enhance: boolean };
type PracticeQuestion = { id: number; examType: "mcq" | "essay"; year: string; subject: string; questionNumber: string; stem: string; options: Record<string, string> | null };
type MagazineArticle = { id: number; title: string; summary: string; issue: string; reviewStatus: string; sequence: number };
type HomeFeed = { book: { id: number; title: string; creator: string; hasCover?: number } | null; course: { id: number; title: string; creator: string; sourceUrl: string } | null; magazine: { id: number; title: string; sourceUrl: string; description?: string; articles?: MagazineArticle[] } | null; listening: ListeningFeed | null; focusMusicUrl?: string; recommended: Array<{ id: number; resourceId: number; title: string; summary: string; startSeconds: number; importance: number }>; ticker: string[] };
type LegalLesson = { documentId: number; title: string; articleNo: string; hierarchy: string; content: string };
type DictionaryResult = { term: string; content: string; sourceUrl: string; sourceLabel: string };
type PracticeCoachMessage = { role: "mentor" | "student"; text: string };
type PracticeRecommendation = { type: string; title: string; location: string; url: string; startSeconds: number | null };

const quickStarts = ["帶我開始今天的刑法", "我想練一題司律真題", "幫我複習不作為犯"];
function cleanMessageText(text: string) { return text.replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1"); }
function isLearningNote(text: string) { const clean = cleanMessageText(text); if (clean.length < 80) return false; if (/尚未匯入|尚未準備|暫時無法|沒有連上|API|錯誤|請稍後|管理者/.test(clean)) return false; return /法條|爭點|要件|涵攝|解題|判斷|原則|例外|學說|實務|教材|刑法|民法|訴訟法|憲法|行政法/.test(clean); }
function youtubeId(value: string) { try { const url = new URL(value); const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? ""); return id.split(/[?&]/)[0]; } catch { return ""; } }
function youtubeEmbedUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1&enablejsapi=1` : ""; }
function youtubeWatchUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : ""; }
function requestYoutubePlay(root: Element | null) { const iframe = root?.querySelector<HTMLIFrameElement>("iframe"); iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "https://www.youtube.com"); }
function dateLabel(value: string) { return value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日") : "今天"; }
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [today, setToday] = useState(() => taipeiDate());
  const [greeting, setGreeting] = useState(() => taipeiGreeting());
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
  const [practiceCoachInput, setPracticeCoachInput] = useState("");
  const [practiceCoachMessages, setPracticeCoachMessages] = useState<PracticeCoachMessage[]>([]);
  const [practiceCoachGap, setPracticeCoachGap] = useState("");
  const [practiceCoachIssue, setPracticeCoachIssue] = useState("");
  const [practiceCoachRecommendations, setPracticeCoachRecommendations] = useState<PracticeRecommendation[]>([]);
  const [practiceCoaching, setPracticeCoaching] = useState(false);
  const practiceCoachEndRef = useRef<HTMLDivElement>(null);
  const [savedMessage, setSavedMessage] = useState<number | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [legalLesson, setLegalLesson] = useState<LegalLesson | null>(null);
  const [dictionaryTerm, setDictionaryTerm] = useState("");
  const [dictionaryResult, setDictionaryResult] = useState<DictionaryResult | null>(null);
  const [dictionaryFeatured, setDictionaryFeatured] = useState<DictionaryResult | null>(null);
  const [dictionaryFeaturedLoading, setDictionaryFeaturedLoading] = useState(false);
  const [dictionaryNotice, setDictionaryNotice] = useState("");
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [musicActivated, setMusicActivated] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<number | null>(null);
  const handoffHandled = useRef(false);

  useEffect(() => {
    const refreshTaipeiClock = () => {
      setToday(taipeiDate());
      setGreeting(taipeiGreeting());
    };
    refreshTaipeiClock();
    const timer = window.setInterval(refreshTaipeiClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    fetch("/api/chat/history").then(async (response) => {
      if (!response.ok) throw new Error("history unavailable");
      const data = await response.json() as { sessionId?: number | null; messages?: Message[]; today?: string; todayTasks?: TodayTask[]; greeting?: string; todayRecords?: TodayRecord[] };
      setSessionId(data.sessionId ?? null);
      setToday(data.today ?? taipeiDate());
      setTodayTasks(data.todayTasks ?? []);
      setGreeting(data.greeting ?? taipeiGreeting());
      const restored = data.messages ?? [];
      if (restored.length) setMessages(restored);
      else if ((data.todayTasks ?? []).length) {
        const pending = (data.todayTasks ?? []).filter((task) => task.status !== "completed");
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: pending.length ? `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天已經安排好 ${pending.length} 項任務。我們從第一項「${pending[0].title}」開始，好嗎？` : `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天的任務都完成了。要不要趁狀態正好，先預習明天的內容？` }]);
      } else {
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}，${recordSummary}我是司律備考的 AI 教練。${records.length ? "我們接著把今天的學習往下推進。" : "今天還沒有安排任務，我可以先根據你的目標與可用時間，幫你建立第一份學習計畫。"}` }]);
      }
    }).catch(() => {
      setMessages([{ role: "mentor", text: `${taipeiGreeting()}，我是司律備考的 AI 教練。今天想從哪一科開始？` }]);
    }).finally(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => { fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed(await response.json() as HomeFeed); }).catch(() => undefined); }, []);
  useEffect(() => { fetch("/api/legal-learning").then(async (response) => { if (response.ok) setLegalLesson(((await response.json()) as { article?: LegalLesson | null }).article ?? null); }).catch(() => undefined); }, []);
  useEffect(() => { fetch("/api/legal-dictionary?random=1").then(async (response) => { if (response.ok) setDictionaryFeatured(await response.json() as DictionaryResult); }).catch(() => undefined); }, []);
  useEffect(() => { practiceCoachEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [practiceCoachMessages, practiceCoaching]);

  useEffect(() => {
    fetch("/api/dashboard").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as DashboardData;
      setDashboard(data);
    }).catch(() => undefined);
  }, []);

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

  function toggleMusic(event: MouseEvent<HTMLButtonElement>) {
    const root = event.currentTarget.closest(".rail-music-card");
    setMusicActivated(true);
    if (musicPlaying) {
      const iframe = root?.querySelector<HTMLIFrameElement>("iframe");
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "stopVideo", args: [] }), "https://www.youtube.com");
      setMusicPlaying(false);
    } else {
      requestYoutubePlay(root);
      setMusicPlaying(true);
    }
  }

  async function startPractice(examType: "mcq" | "essay") {
    setPracticeLoading(true); setPracticeAnswer(null); setPracticeCoachInput(""); setPracticeCoachMessages([]); setPracticeCoachGap(""); setPracticeCoachIssue(""); setPracticeCoachRecommendations([]);
    try {
      const response = await fetch(`/api/practice?type=${examType}`); const result = await response.json() as { question?: PracticeQuestion | null; message?: string };
      if (result.question) setPracticeQuestion(result.question);
      else { setPracticeQuestion(null); setMessages((current) => [...current, { role: "mentor", text: result.message ?? "真題庫尚未準備完成。管理者匯入並確認題目後，我就能從這裡開始帶你練習。" }]); }
    } finally { setPracticeLoading(false); }
  }

  function askMagazineArticle(article: MagazineArticle) {
    void send(`請帶我學習月旦法學教室的文章「${article.title}」。\n摘要：${article.summary || "尚未完成摘要。"}\n核心爭點：${article.issue || "尚未擷取到核心爭點，請先從文章標題辨認並清楚標示推測。"}\n請以這個爭點為核心，先說明判斷分岔，再問我一個可以直接回答的小問題。`);
  }

  function teachLegalLesson() {
    if (!legalLesson) return;
    void send(`請帶我學習這條法條：\n${legalLesson.title} ${legalLesson.articleNo}\n${legalLesson.content}\n請先用一句話說明考點，再用一個生活化或司律題型情境問我；不要一開始就給完整答案。`);
  }

  async function loadRandomLegalLesson() {
    const response = await fetch("/api/legal-learning?random=1");
    if (!response.ok) return;
    const result = await response.json() as { article?: LegalLesson | null };
    if (result.article) setLegalLesson(result.article);
  }

  async function searchDictionary(event: FormEvent) {
    event.preventDefault();
    const term = dictionaryTerm.trim();
    if (!term) return;
    setDictionaryLoading(true);
    setDictionaryNotice("");
    setDictionaryResult(null);
    const response = await fetch(`/api/legal-dictionary?q=${encodeURIComponent(term)}`);
    const result = await response.json() as DictionaryResult & { error?: string };
    if (response.ok) setDictionaryResult(result);
    else setDictionaryNotice(result.error ?? "官方辭典暫時查不到這個名詞");
    setDictionaryLoading(false);
  }

  async function loadRandomDictionary() {
    setDictionaryFeaturedLoading(true);
    try {
      const response = await fetch("/api/legal-dictionary?random=1");
      if (response.ok) setDictionaryFeatured(await response.json() as DictionaryResult);
    } finally {
      setDictionaryFeaturedLoading(false);
    }
  }

  function teachDictionaryTerm() {
    if (!dictionaryResult) return;
    void send(`請用司律考生能理解的方式教我法律名詞「${dictionaryResult.term}」。\n司法院裁判書用語辭典內容：\n${dictionaryResult.content}\n請先說明白話意思，再補充它常出現在哪一科、容易和什麼概念混淆，最後問我一個判斷題。`);
  }

  function teachFeaturedDictionaryTerm() {
    if (!dictionaryFeatured) return;
    void send(`請用司律考生能理解的方式教我法律名詞「${dictionaryFeatured.term}」。\n司法院裁判書用語辭典內容：\n${dictionaryFeatured.content}\n請先說明白話意思，再補充它常出現在哪一科、容易和什麼概念混淆，最後問我一個判斷題。`);
  }

  function recommendationUrl(item: PracticeRecommendation) {
    if (!item.url || item.startSeconds == null) return item.url;
    try {
      const url = new URL(item.url);
      if (url.hostname === "youtu.be") url.searchParams.set("t", String(item.startSeconds));
      else if (url.hostname.includes("youtube.com")) url.searchParams.set("t", `${item.startSeconds}s`);
      else url.hash = `t=${item.startSeconds}`;
      return url.toString();
    } catch { return item.url; }
  }

  async function askPracticeCoach() {
    if (!practiceQuestion || practiceCoaching || !practiceCoachInput.trim()) return;
    const studentMessage = { role: "student" as const, text: practiceCoachInput.trim() };
    const messagesForRequest = [...practiceCoachMessages, studentMessage];
    setPracticeCoachMessages(messagesForRequest);
    setPracticeCoachInput("");
    setPracticeCoaching(true);
    try {
      const response = await fetch("/api/practice-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: practiceQuestion.id, selectedAnswer: practiceAnswer?.selected ?? null, messages: messagesForRequest }) });
      const result = await response.json() as { reply?: string; diagnosedGap?: string; keyIssue?: string; recommendations?: PracticeRecommendation[]; error?: string };
      setPracticeCoachMessages((current) => [...current, { role: "mentor", text: result.reply ?? result.error ?? "教練暫時無法接續，請稍後再試。" }]);
      if (response.ok) {
        setPracticeCoachGap(result.diagnosedGap ?? "");
        setPracticeCoachIssue(result.keyIssue ?? "");
        setPracticeCoachRecommendations(result.recommendations ?? []);
      }
    } finally {
      setPracticeCoaching(false);
    }
  }

  function beginEssayCoach() {
    setPracticeCoachMessages([{ role: "mentor", text: "先不要急著寫完整答案。請先說出本題的人物、行為、時間，以及你看到的第一個法律爭點。" }]);
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

      <div className="home-date-line" aria-label={`${greeting}，今天日期`}><span>今天｜{dateLabel(today)}</span>{legalLesson ? <div className="daily-law-actions"><button type="button" className="daily-law-button" onClick={teachLegalLesson}><b>法條學習</b><span>{legalLesson.title} {legalLesson.articleNo}</span></button><button type="button" className="daily-law-swap" onClick={() => void loadRandomLegalLesson()}>換法條</button></div> : <span className="daily-law-pending"><b>法條學習</b><span>全國法規匯入後，點擊隨機學習</span></span>}</div>

      <section className="top-dictionary-card" aria-label="法律辭典">
        <div className="top-dictionary-intro"><div className="rail-title"><strong>法律辭典</strong><a href="https://terms.judicial.gov.tw/" target="_blank" rel="noreferrer">司法院來源 ↗</a></div><p>查一個法律名詞，或讓 AI 隨機抽一個司律常見用語。</p></div>
        {dictionaryFeatured && <div className="top-dictionary-featured"><div><span>AI 今日隨機</span><strong>{dictionaryFeatured.term}</strong></div><p>{dictionaryFeatured.content}</p><div><button type="button" onClick={teachFeaturedDictionaryTerm}>讓 AI 教我</button><button type="button" onClick={() => void loadRandomDictionary()} disabled={dictionaryFeaturedLoading}>{dictionaryFeaturedLoading ? "換題中…" : "換一個"}</button></div></div>}
        <div className="top-dictionary-search"><form onSubmit={searchDictionary}><input value={dictionaryTerm} onChange={(event) => setDictionaryTerm(event.target.value)} placeholder="例如：比例原則、抗告、系爭" aria-label="輸入法律名詞" /><button disabled={dictionaryLoading}>{dictionaryLoading ? "查詢中…" : "查辭典"}</button></form>{dictionaryNotice && <small className="dictionary-notice">{dictionaryNotice}</small>}{dictionaryResult && <div className="dictionary-result"><strong>{dictionaryResult.term}</strong><p>{dictionaryResult.content}</p><button type="button" onClick={teachDictionaryTerm}>讓 AI 教我</button></div>}</div>
      </section>

      <div className={`command-layout rail-${railSide}`}>
      <section className="conversation" aria-live="polite">
        <div className="conversation-heading">
          <p>AI 司律作戰中心</p>
          <h1>今天，照計畫前進。</h1>
          <span>我會讀取你的計畫、進度與教材，接著上次的地方帶你學。</span>
        </div>
        {practiceQuestion && <section className="practice-card" aria-label="對話中的真題教練">
          <div className="practice-meta"><span>{practiceQuestion.examType === "mcq" ? "一試選擇題" : "二試申論題"}</span><strong>{practiceQuestion.year} · {practiceQuestion.subject} · 第 {practiceQuestion.questionNumber} 題</strong><button onClick={() => setPracticeQuestion(null)}>收起</button></div>
          <p className="practice-stem">{practiceQuestion.stem}</p>
          {practiceQuestion.examType === "mcq" && practiceQuestion.options ? <div className="option-grid">{["A", "B", "C", "D"].filter((key) => practiceQuestion.options?.[key]).map((key) => { const selected = practiceAnswer?.selected === key; const correct = practiceAnswer?.correctAnswer === key; return <button className={`${selected ? "selected" : ""} ${practiceAnswer && correct ? "correct" : ""} ${practiceAnswer && selected && !practiceAnswer.correct ? "wrong" : ""}`} disabled={Boolean(practiceAnswer)} onClick={() => answerMcq(key)} key={key}><b>{key}</b><span>{practiceQuestion.options?.[key]}</span></button>; })}</div> : <button className="essay-start" onClick={beginEssayCoach}>開始學審題</button>}
          {practiceAnswer && <div className={`answer-result ${practiceAnswer.correct ? "correct" : "wrong"}`}><strong>{practiceAnswer.correct ? "答對了" : "再想一步"}</strong><span>正確答案：{practiceAnswer.correctAnswer}。請在下方直接回答教練。</span></div>}
          {practiceCoachMessages.length > 0 && <section className="practice-coach home-practice-coach">
            <header><div><span>真題教練</span><h3>直接在這道題裡回答</h3></div></header>
            <div className="practice-coach-messages">{practiceCoachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}<div ref={practiceCoachEndRef} /></div>
            {(practiceCoachIssue || practiceCoachGap) && <div className="practice-diagnosis">{practiceCoachIssue && <p><b>核心爭點</b>{practiceCoachIssue}</p>}{practiceCoachGap && <p><b>需要加強</b>{practiceCoachGap}</p>}</div>}
            <form onSubmit={(event) => { event.preventDefault(); void askPracticeCoach(); }}><textarea value={practiceCoachInput} onChange={(event) => setPracticeCoachInput(event.target.value)} placeholder="直接回答教練的問題；不知道也可以說卡在哪裡" rows={2} /><button disabled={practiceCoaching || !practiceCoachInput.trim()}>{practiceCoaching ? "教練思考中…" : "送出回答"}</button></form>
            {practiceCoachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{practiceCoachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}
          </section>}
        </section>}

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
        <section className="rail-card rail-practice"><div className="rail-title"><strong>練真題</strong><span>真題直接嵌入對話</span></div><div><button onClick={() => startPractice("mcq")} disabled={practiceLoading}>一試選擇題</button><button onClick={() => startPractice("essay")} disabled={practiceLoading}>二試申論題</button></div></section>
        <article className="home-editorial-card rail-editorial-card"><div className="column-kicker">LISTENING SOLUTION</div><div className="home-editorial-head"><div><h2>聽解題專區</h2><span>{homeFeed?.listening ? `${homeFeed.listening.year} · ${homeFeed.listening.subject}` : "把解題變成可以反覆聽的學習段落"}</span></div><i>{homeFeed?.listening ? "▶" : "聽"}</i></div>{homeFeed?.listening ? <><p>先聽老師抓爭點，再回學習專區接續今天的題目。</p><ListeningPlayer item={homeFeed.listening} compact /></> : <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>}</article>
        <article className="home-editorial-card rail-editorial-card rail-magazine-card"><div className="column-kicker">LAW CLASSROOM</div><div className="home-editorial-head"><div><h2>法教專區</h2><span>顯示摘要；按「爭點解析」時會一併分析核心爭點</span></div><i>法</i></div>{homeFeed?.magazine ? <><strong>{homeFeed.magazine.title}</strong><div className="magazine-article-list">{(homeFeed.magazine.articles ?? []).map((article) => <div className="magazine-article-row" key={article.id}><div className="magazine-article-copy"><h3>{article.title}</h3>{article.summary && <p className="magazine-article-summary"><b>摘要</b>{article.summary}</p>}</div><button type="button" onClick={() => askMagazineArticle(article)}>爭點解析</button></div>)}</div><a href={homeFeed.magazine.sourceUrl} target="_blank" rel="noreferrer">查看法學教室來源 →</a></> : <p className="column-empty">後台匯入並發布法學教室試讀內容後，最新專區會出現在這裡。</p>}</article>
        <article className="home-editorial-card rail-editorial-card rail-music-card"><div className="column-kicker">FOCUS MUSIC</div><div className="home-editorial-head"><div><h2>讀書音樂</h2><span>{musicPlaying ? "播放中 · 再按一次停止" : "需要時再開啟 · 請點擊播放音樂"}</span></div><button type="button" className="music-play-button" onClick={toggleMusic} aria-label={musicPlaying ? "停止讀書音樂" : "點擊播放讀書音樂"}><span>{musicPlaying ? "■" : "▶"}</span><b>{musicPlaying ? "停止音樂" : "播放音樂"}</b></button></div>{youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "") ? <><iframe className={`music-iframe ${musicActivated ? "is-active" : ""}`} title="司律備考讀書音樂" src={youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "")} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen loading="eager" /><a className="music-open-link" href={youtubeWatchUrl(homeFeed?.focusMusicUrl ?? "")} target="_blank" rel="noreferrer">無法播放時，在 YouTube 開啟 ↗</a></> : <p className="column-empty">管理後台設定讀書音樂後，會在這裡提供播放。</p>}</article>
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
