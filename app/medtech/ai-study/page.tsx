"use client";

import { useEffect, useRef, useState } from "react";
import { ListeningPlayer } from "../../listening-player";
import MedtechHeaderActions from "../MedtechHeaderActions";

type Subtitle = { id: number; segmentId: number | null; startSeconds: number; endSeconds: number; text: string; sequence: number };
type Question = { id: number; year: string; stem: string; options: Record<string, string>; answer: string; explanation: string; answerSource: string; topic?: string; questionNumber?: string; audioUrl?: string; subtitles?: Subtitle[] };
type Message = { role: "student" | "mentor"; text: string; source?: string; usage?: { model: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number } };
type GuidedEvent = { type: string; label: string; detail?: string; at: string };
type GuidedStateOverrides = { question?: Question; level?: string; selectedAnswer?: string; hintUsed?: boolean; comparisonUsed?: boolean; voiceUnlocked?: boolean; messages?: Message[]; events?: GuidedEvent[]; startedAt?: string; status?: "in_progress" | "completed" };
type Paywall = { title: string; text: string; url: string; kind: "credits" };
const topics = ["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題"];

function plainText(value: string) {
  return value.replace(/^#{1,6}\s*/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "").replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) => row.split("|").map((cell) => cell.trim()).filter(Boolean).join("　｜　")).replace(/^[*_]{3,}\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function readResponseJson<T extends Record<string, unknown>>(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: "伺服器回應格式錯誤，請稍後再試。" } as T;
  }
}

export default function MedtechAiStudy() {
  const [level, setLevel] = useState("入門");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [questionLoading, setQuestionLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [hintUsed, setHintUsed] = useState(false);
  const [comparisonUsed, setComparisonUsed] = useState(false);
  const [aiCredits, setAiCredits] = useState(10);
  const [voiceUnlocked, setVoiceUnlocked] = useState(false);
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const [recordSaved, setRecordSaved] = useState(false);
  const chatRef = useRef<HTMLElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const questionRef = useRef<Question | null>(null);
  const eventsRef = useRef<GuidedEvent[]>([]);
  const startedAtRef = useRef(Date.now());
  const recordSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  function appendGuidedEvent(event: Omit<GuidedEvent, "at">, current = eventsRef.current) {
    const next = [...current, { ...event, at: new Date().toISOString() }].slice(-100);
    eventsRef.current = next;
    return next;
  }

  function queueGuidedRecord(overrides: GuidedStateOverrides = {}) {
    const activeQuestion = overrides.question ?? questionRef.current;
    if (!activeQuestion) return recordSaveQueueRef.current;
    const stateQuestion = {
      id: activeQuestion.id,
      year: activeQuestion.year,
      questionNumber: activeQuestion.questionNumber ?? "",
      topic: activeQuestion.topic ?? topic,
      stem: activeQuestion.stem,
      options: activeQuestion.options,
      correctAnswer: activeQuestion.answer,
    };
    const state = {
      version: 1,
      question: stateQuestion,
      level: overrides.level ?? level,
      selectedAnswer: overrides.selectedAnswer ?? selectedAnswer,
      correct: (overrides.selectedAnswer ?? selectedAnswer) ? (overrides.selectedAnswer ?? selectedAnswer) === activeQuestion.answer : null,
      hintUsed: overrides.hintUsed ?? hintUsed,
      comparisonUsed: overrides.comparisonUsed ?? comparisonUsed,
      voiceUnlocked: overrides.voiceUnlocked ?? voiceUnlocked,
      messages: overrides.messages ?? messages,
      events: overrides.events ?? eventsRef.current,
      startedAt: overrides.startedAt ?? new Date(startedAtRef.current).toISOString(),
      lastActivityAt: new Date().toISOString(),
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)),
    };
    recordSaveQueueRef.current = recordSaveQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch("/api/guided-practice", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: activeQuestion.id, mode: "guided", status: overrides.status ?? "in_progress", state }) });
      if (response.ok) setRecordSaved(true);
    });
    return recordSaveQueueRef.current;
  }

  async function loadUsage() {
    const response = await fetch("/api/medtech/usage", { cache: "no-store" });
    if (!response.ok) return;
    const result = await readResponseJson<{ aiCredits?: number }>(response);
    setAiCredits(result.aiCredits ?? 0);
  }

  async function loadQuestion(nextTopic = topic) {
    if (questionRef.current) {
      await queueGuidedRecord({ status: "completed", messages, events: eventsRef.current });
    }
    setQuestionLoading(true);
    setError("");
    setSelectedAnswer("");
    setHintUsed(false);
    setComparisonUsed(false);
    setVoiceUnlocked(false);
    try {
      const query = new URLSearchParams({ limit: "1" });
      if (nextTopic) query.set("topic", nextTopic);
      const response = await fetch(`/api/medtech/questions?${query}`);
      const result = await readResponseJson<{ items?: Question[]; error?: string; points?: number }>(response);
      if (response.status === 402) {
        setPaywall({ kind: "credits", title: "點數不足", text: result.error || "查看一題扣 1 點，同一題 7 天內可無限重做，請先購買點數。", url: "/medtech/upgrade?reason=points" });
        throw new Error(result.error || "點數不足；請先購買點數。");
      }
      if (!response.ok || !result.items?.[0]) throw new Error(result.error || "目前沒有可用題目");
      if (typeof result.points === "number") setAiCredits(result.points);
      const questionItem = result.items[0];
      const questionTopic = questionItem.topic || nextTopic;
      const nextQuestion = { ...questionItem, audioUrl: questionTopic === "全真模擬試題" ? questionItem.audioUrl : undefined };
      const initialMessages: Message[] = [{ role: "mentor", text: "請直接點選 A、B、C 或 D 作答；也可以先索取提示。" }];
      questionRef.current = nextQuestion;
      startedAtRef.current = Date.now();
      eventsRef.current = [{ type: "question_loaded", label: "抽到題目", detail: `${nextQuestion.year} 年第 ${nextQuestion.questionNumber || nextQuestion.id} 題`, at: new Date().toISOString() }];
      setRecordSaved(false);
      setQuestion(nextQuestion);
      setMessages(initialMessages);
      void queueGuidedRecord({ question: nextQuestion, selectedAnswer: "", hintUsed: false, comparisonUsed: false, voiceUnlocked: false, messages: initialMessages, events: eventsRef.current, startedAt: new Date(startedAtRef.current).toISOString() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "題目讀取失敗");
    } finally {
      setQuestionLoading(false);
    }
  }

  useEffect(() => { void loadQuestion(""); void loadUsage(); }, []);
  useEffect(() => { if (!loading && messages.length < 2) return; answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })); }, [loading, messages.length]);

  async function send(text = input) {
    const value = text.trim();
    if (!value || !question || loading) return;
    const next = [...messages, { role: "student" as const, text: value }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError("");
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const response = await fetch("/api/medtech/tutor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, level, messages: next }) });
      const result = await response.json() as { reply?: string; source?: string; creditsRemaining?: number; usage?: Message["usage"]; error?: string; upgradeUrl?: string };
      if (response.status === 402) { setPaywall({ kind: "credits", title: "點數已用完", text: result.error || "AI 追問每題扣 1 點，請先購買點數。", url: result.upgradeUrl || "/medtech/upgrade?reason=points" }); return; }
      if (!response.ok || !result.reply) throw new Error(result.error || "AI 回答失敗");
      setAiCredits(result.creditsRemaining ?? Math.max(0, aiCredits - 1));
      window.dispatchEvent(new Event("medtech-points-updated"));
      const mentorMessage: Message = { role: "mentor", text: plainText(result.reply!), source: result.source, usage: result.usage };
      const finalMessages = [...next, mentorMessage];
      const nextEvents = appendGuidedEvent({ type: "ai_followup", label: "AI 追問", detail: value.slice(0, 120) });
      setMessages(finalMessages);
      void queueGuidedRecord({ messages: finalMessages, events: nextEvents });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 回答失敗");
    } finally {
      setLoading(false);
    }
  }

  async function requestCachedTutor(mode: "hint" | "compare") {
    if (!question || loading || (mode === "hint" && (hintUsed || selectedAnswer)) || (mode === "compare" && (!selectedAnswer || comparisonUsed))) return;
    const prompt = mode === "hint" ? "我先索取一個判斷提示。" : "請比較四個選項，簡短說明即可。";
    const next = [...messages, { role: "student" as const, text: prompt }];
    setMessages(next);
    setLoading(true);
    setError("");
    if (mode === "hint") setHintUsed(true);
    try {
      const response = await fetch("/api/medtech/tutor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, level, messages: next, mode, selectedAnswer }) });
      const result = await response.json() as { reply?: string; source?: string; usage?: Message["usage"]; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error || "AI 回答失敗");
      if (mode === "compare") setComparisonUsed(true);
      const mentorMessage: Message = { role: "mentor", text: plainText(result.reply!), source: result.source, usage: result.usage };
      const finalMessages = [...next, mentorMessage];
      const nextEvents = appendGuidedEvent({ type: mode === "hint" ? "hint" : "compare", label: mode === "hint" ? "取得判斷提示" : "完成比較選項" });
      setMessages(finalMessages);
      void queueGuidedRecord({ messages: finalMessages, events: nextEvents, hintUsed: mode === "hint" ? true : hintUsed, comparisonUsed: mode === "compare" ? true : comparisonUsed });
    } catch (caught) {
      if (mode === "hint") setHintUsed(false);
      setError(caught instanceof Error ? caught.message : "AI 回答失敗");
    } finally {
      setLoading(false);
    }
  }

  async function unlockVoice() {
    if (!question) return;
    if (!question.audioUrl || question.audioUrl === "__voice_missing__") { setError("這一題尚未綁定老師語音檔，請在後台重新匯入語音包後再試。"); return; }
    try {
      const response = await fetch("/api/medtech/usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "audioComplete", questionId: question.id }) });
      const result = await response.json() as { access?: "credit"; aiCredits?: number; error?: string; code?: string; upgradeUrl?: string };
      if (response.status === 402) { setPaywall({ kind: "credits", title: "點數不足", text: result.error || "語音完整解析每次扣 1 點，請先購買點數。", url: result.upgradeUrl || "/medtech/upgrade?reason=points" }); return; }
      if (!response.ok) throw new Error(result.error || "語音解析開啟失敗");
      setAiCredits(result.aiCredits ?? aiCredits);
      window.dispatchEvent(new Event("medtech-points-updated"));
      setVoiceUnlocked(true);
      const nextEvents = appendGuidedEvent({ type: "voice", label: "開啟老師語音解析", detail: "扣 1 點，24 小時內可重聽" });
      void queueGuidedRecord({ voiceUnlocked: true, events: nextEvents });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "語音解析開啟失敗");
    }
  }

  function chooseAnswer(letter: string) {
    if (loading || selectedAnswer || !question) return;
    const correct = letter === question.answer;
    setSelectedAnswer(letter);
    const nextMessages: Message[] = [...messages, { role: "student", text: `我選 ${letter}。` }, { role: "mentor", text: `你選 ${letter}，${correct ? "答對了" : "答錯了"}。接下來可以按「比較選項」查看簡答。` }];
    const nextEvents = appendGuidedEvent({ type: "answer", label: `選擇答案 ${letter}`, detail: correct ? "答對" : "答錯" });
    setMessages(nextMessages);
    void queueGuidedRecord({ selectedAnswer: letter, messages: nextMessages, events: nextEvents });
  }

  function chooseLevel(nextLevel: string) {
    setLevel(nextLevel);
    const nextEvents = appendGuidedEvent({ type: "level", label: "調整學習程度", detail: nextLevel });
    void queueGuidedRecord({ level: nextLevel, events: nextEvents });
  }

  const loadingLabel = (label: string) => <span className="medtech-loading-label"><i className="medtech-loading-spinner" aria-hidden="true" />{label}</span>;
  return <main className="medtech-ai-page"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>AI STUDY</small></div></a><MedtechHeaderActions /></header><section className="medtech-ai-shell"><aside className="medtech-ai-settings"><span>醫檢 AI 學習</span><h1>從一道題，真正弄懂一個觀念</h1><p>先用提示思考，再作答解鎖比較；康情老師語音完整解析每次扣 1 點，24 小時內可重聽不重扣。</p><div className="medtech-usage-badges"><span>可用點數 <b>{aiCredits}</b> 點</span><span>語音解析 <b>1</b> 點／24 小時</span></div><label>我的程度<div>{["入門", "進階", "考前衝刺"].map((item) => <button className={level === item ? "active" : ""} onClick={() => chooseLevel(item)} key={item}>{item}</button>)}</div></label><label>學習主題<select value={topic} onChange={(event) => { setTopic(event.target.value); void loadQuestion(event.target.value); }}><option value="">全部主題</option>{topics.map((item) => <option key={item}>{item}</option>)}</select></label><button className="medtech-new-question" onClick={() => void loadQuestion()} disabled={questionLoading} aria-busy={questionLoading}>{questionLoading ? loadingLabel("題目載入中…") : "換一道題"}</button><small>提示與比較選項不扣點；比較選項每題限一次；語音完整解析每次 1 點；AI 追問每題 1 點。</small><div className="medtech-ai-record-link"><a href="/medtech/ai-study/history">查看引導學習紀錄 →</a><span>{recordSaved ? "本題過程已保存" : "作答後自動保存完整過程"}</span></div></aside><section className="medtech-ai-workspace">{questionLoading ? <div className="medtech-ai-empty">{loadingLabel("正在從正式題庫抽題…")}</div> : question ? <><article className="medtech-ai-question"><header><span>{question.topic || topic || "臨床病毒學"}</span><small>{question.year} 年專技</small></header><h2>{question.stem}</h2><div>{Object.entries(question.options).map(([key, value]) => <button type="button" disabled={loading || Boolean(selectedAnswer)} className={selectedAnswer === key ? "selected" : ""} onClick={() => chooseAnswer(key)} key={key}><b>{key}</b><span>{value}</span>{selectedAnswer === key && <em>已選擇</em>}</button>)}</div><small className="medtech-answer-hint">流程：先取得提示，再選答案；選完後才開放比較與追問。</small></article><div className="medtech-ai-quick"><button className="study-action-hint" disabled={loading || hintUsed || Boolean(selectedAnswer)} aria-busy={loading} onClick={() => void requestCachedTutor("hint")}>{loading ? loadingLabel("整理中…") : hintUsed ? "已取得提示" : "給我提示"}</button><button className="study-action-compare" disabled={loading || !selectedAnswer || comparisonUsed} aria-busy={loading} onClick={() => void requestCachedTutor("compare")}>{loading ? loadingLabel("比較中…") : comparisonUsed ? "已完成比較" : "比較選項"}</button>{question.audioUrl&&<button className="voice-explanation-button" disabled={loading || !selectedAnswer || voiceUnlocked} aria-busy={loading} onClick={() => void unlockVoice()}>{loading ? loadingLabel("開啟語音中…") : voiceUnlocked ? "已開啟語音完整解析（24 小時內可重聽）" : "語音完整解析（1 點／24 小時）"}</button>}</div><div className="medtech-action-note">{!selectedAnswer ? "目前只能取得一個提示；請先思考並選擇答案。" : "已完成作答：可比較選項、解鎖語音完整解析，或輸入問題（每題扣 1 點）。"}</div>{voiceUnlocked && question.audioUrl && <section className="medtech-voice-unlocked"><div><b>本題語音完整解析</b><span>已扣 1 點解鎖，24 小時內可重聽</span></div><ListeningPlayer compact item={{ id: question.id, title: `第 ${question.questionNumber || question.id} 題語音完整解析`, year: question.year, subject: question.topic || "醫事檢驗", questionText: question.stem, audioUrl: question.audioUrl, subtitles: question.subtitles || [] }} /></section>}<div ref={answerRef} /><section className="medtech-ai-chat" ref={chatRef}>{messages.map((message, index) => <article className={message.role} key={index}><b>{message.role === "mentor" ? "醫檢 AI 助教" : "我"}</b><p>{plainText(message.text)}</p>{message.role === "mentor" && message.source && <small>{message.source}{message.usage ? ` · ${message.usage.model} · ${message.usage.inputTokens + message.usage.outputTokens} tokens · ${(message.usage.durationMs / 1000).toFixed(1)} 秒 · 約 NT$ ${(message.usage.estimatedCostUsd * 32.5).toFixed(3)}` : ""}</small>}</article>)}{loading && <article className="mentor loading"><b>醫檢 AI 助教</b><p>正在整理內容…</p></article>}</section><form onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} disabled={!selectedAnswer || loading} onChange={(event) => setInput(event.target.value)} placeholder={selectedAnswer ? "還想問什麼？每個問題扣 1 點。" : "請先選擇答案，之後才能追問。"} rows={3} /><button disabled={!selectedAnswer || loading || !input.trim()} aria-busy={loading}>{loading ? loadingLabel("AI 回答整理中…") : "送出問題（扣 1 點）"}</button></form></> : <div className="medtech-ai-empty">{error || "目前沒有可用題目"}</div>}{error && question && <p className="medtech-ai-error">{error}</p>}</section></section>{paywall && <div className="medtech-paywall-backdrop" role="presentation" onMouseDown={() => setPaywall(null)}><section className="medtech-paywall" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>醫檢師點數</span><h2>{paywall.title}</h2><p>{paywall.text}</p><div><button type="button" onClick={() => setPaywall(null)}>稍後再說</button><a href={paywall.url}>前往購買點數</a></div></section></div>}</main>;
}
