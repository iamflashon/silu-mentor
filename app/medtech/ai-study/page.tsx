"use client";

import { useEffect, useRef, useState } from "react";
import { ListeningPlayer } from "../../listening-player";

type Subtitle = { id: number; segmentId: number | null; startSeconds: number; endSeconds: number; text: string; sequence: number };
type Question = { id: number; year: string; stem: string; options: Record<string, string>; answer: string; explanation: string; answerSource: string; topic?: string; questionNumber?: string; audioUrl?: string; subtitles?: Subtitle[] };
type Message = { role: "student" | "mentor"; text: string; source?: string; usage?: { model: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number } };
type Paywall = { title: string; text: string; url: string; kind: "audio" | "credits" };
const topics = ["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題"];

function plainText(value: string) {
  return value.replace(/^#{1,6}\s*/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "").replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) => row.split("|").map((cell) => cell.trim()).filter(Boolean).join("　｜　")).replace(/^[*_]{3,}\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
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
  const [audioRemaining, setAudioRemaining] = useState(3);
  const [audioTrialLimit, setAudioTrialLimit] = useState(3);
  const [aiCredits, setAiCredits] = useState(30);
  const [voiceUnlocked, setVoiceUnlocked] = useState(false);
  const [voiceAccess, setVoiceAccess] = useState<"trial" | "credit" | null>(null);
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const chatRef = useRef<HTMLElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  async function loadUsage() {
    const response = await fetch("/api/medtech/usage", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { audioTrialLimit?: number; audioRemaining?: number; aiCredits?: number };
    setAudioTrialLimit(result.audioTrialLimit ?? 3);
    setAudioRemaining(result.audioRemaining ?? 0);
    setAiCredits(result.aiCredits ?? 0);
  }

  async function loadQuestion(nextTopic = topic) {
    setQuestionLoading(true);
    setError("");
    setSelectedAnswer("");
    setHintUsed(false);
    setVoiceUnlocked(false);
    setVoiceAccess(null);
    try {
      const query = new URLSearchParams({ limit: "1" });
      if (nextTopic) query.set("topic", nextTopic);
      const response = await fetch(`/api/medtech/questions?${query}`);
      const result = await response.json() as { items?: Question[]; error?: string };
      if (!response.ok || !result.items?.[0]) throw new Error(result.error || "目前沒有可用題目");
      setQuestion(result.items[0]);
      setMessages([{ role: "mentor", text: "請直接點選 A、B、C 或 D 作答；也可以先索取提示。" }]);
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
      if (response.status === 402) { setPaywall({ kind: "credits", title: "AI 互動點數已用完", text: result.error || "想繼續和醫檢 AI 助教互動，請購買點數或訂閱方案。", url: result.upgradeUrl || "/medtech/upgrade?reason=ai-credits" }); return; }
      if (!response.ok || !result.reply) throw new Error(result.error || "AI 回答失敗");
      setAiCredits(result.creditsRemaining ?? Math.max(0, aiCredits - 1));
      setMessages((current) => [...current, { role: "mentor", text: plainText(result.reply!), source: result.source, usage: result.usage }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 回答失敗");
    } finally {
      setLoading(false);
    }
  }

  async function requestCachedTutor(mode: "hint" | "compare") {
    if (!question || loading || (mode === "hint" && (hintUsed || selectedAnswer)) || (mode === "compare" && !selectedAnswer)) return;
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
      setMessages((current) => [...current, { role: "mentor", text: plainText(result.reply!), source: result.source, usage: result.usage }]);
    } catch (caught) {
      if (mode === "hint") setHintUsed(false);
      setError(caught instanceof Error ? caught.message : "AI 回答失敗");
    } finally {
      setLoading(false);
    }
  }

  async function unlockVoice(useCredit = false) {
    if (!question) return;
    if (!question.audioUrl) { setError("這一題尚未上傳語音解析檔，請先選下一題試聽。"); return; }
    try {
      const response = await fetch("/api/medtech/usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "audioComplete", questionId: question.id, useCredit }) });
      const result = await response.json() as { access?: "trial" | "credit"; audioRemaining?: number; aiCredits?: number; error?: string; code?: string; upgradeUrl?: string };
      if (response.status === 402 && result.code === "AUDIO_TRIAL_EXHAUSTED") { setPaywall({ kind: "audio", title: "免費語音完整解析已用完", text: result.error || "前三題免費試聽已使用完畢。你可以扣 1 點繼續收聽，或加入會員方案。", url: result.upgradeUrl || "/medtech/upgrade?reason=audio-trial" }); return; }
      if (response.status === 402) { setPaywall({ kind: "credits", title: "AI 點數不足", text: result.error || "目前沒有足夠點數解鎖語音完整解析，請購買點數或加入會員。", url: result.upgradeUrl || "/medtech/upgrade?reason=ai-credits" }); return; }
      if (!response.ok) throw new Error(result.error || "語音解析開啟失敗");
      setAudioRemaining(result.audioRemaining ?? audioRemaining);
      setAiCredits(result.aiCredits ?? aiCredits);
      setVoiceAccess(result.access ?? (useCredit ? "credit" : "trial"));
      setVoiceUnlocked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "語音解析開啟失敗");
    }
  }

  function chooseAnswer(letter: string) {
    if (loading || selectedAnswer || !question) return;
    const correct = letter === question.answer;
    setSelectedAnswer(letter);
    setMessages((current) => [...current, { role: "student", text: `我選 ${letter}。` }, { role: "mentor", text: `你選 ${letter}，${correct ? "答對了" : "答錯了"}。接下來可以按「比較選項」查看簡答。` }]);
  }

  return <main className="medtech-ai-page"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>AI STUDY</small></div></a><nav><a href="/medtech">首頁</a><a href="/medtech/practice">練國考題</a><a href="/medtech/ai-study" className="active">AI 學習</a></nav></header><section className="medtech-ai-shell"><aside className="medtech-ai-settings"><span>醫檢 AI 學習</span><h1>從一道題，真正弄懂一個觀念</h1><p>先用提示思考，再作答解鎖比較；完整語音解析可用免費次數或 AI 點數開啟。</p><div className="medtech-usage-badges"><span>免費語音完整解析 <b>{audioRemaining}/{audioTrialLimit}</b> 次</span><span>AI 互動點數 <b>{aiCredits}</b> 點</span></div><label>我的程度<div>{["入門", "進階", "考前衝刺"].map((item) => <button className={level === item ? "active" : ""} onClick={() => setLevel(item)} key={item}>{item}</button>)}</div></label><label>學習主題<select value={topic} onChange={(event) => { setTopic(event.target.value); void loadQuestion(event.target.value); }}><option value="">全部主題</option>{topics.map((item) => <option key={item}>{item}</option>)}</select></label><button className="medtech-new-question" onClick={() => void loadQuestion()} disabled={questionLoading}>換一道題</button><small>初始提示與比較選項不扣點；作答後的其他追問每題扣 1 點。</small></aside><section className="medtech-ai-workspace">{questionLoading ? <div className="medtech-ai-empty">正在從正式題庫抽題…</div> : question ? <><article className="medtech-ai-question"><header><span>{question.topic || topic || "臨床病毒學"}</span><small>{question.year} 年專技</small></header><h2>{question.stem}</h2><div>{Object.entries(question.options).map(([key, value]) => <button type="button" disabled={loading || Boolean(selectedAnswer)} className={selectedAnswer === key ? "selected" : ""} onClick={() => chooseAnswer(key)} key={key}><b>{key}</b><span>{value}</span>{selectedAnswer === key && <em>已選擇</em>}</button>)}</div><small className="medtech-answer-hint">流程：先取得提示，再選答案；選完後才開放比較與追問。</small></article><div className="medtech-ai-quick"><button className="study-action-hint" disabled={loading || hintUsed || Boolean(selectedAnswer)} onClick={() => void requestCachedTutor("hint")}>{hintUsed ? "已取得提示" : "給我提示"}</button><button className="study-action-compare" disabled={loading || !selectedAnswer} onClick={() => void requestCachedTutor("compare")}>比較選項</button>{question.audioUrl&&<button className="voice-explanation-button" disabled={loading || !selectedAnswer || voiceUnlocked} onClick={() => void unlockVoice()}>{voiceUnlocked ? "已開啟語音完整解析" : "語音完整解析"}</button>}</div><div className="medtech-action-note">{!selectedAnswer ? "目前只能取得一個提示；請先思考並選擇答案。" : "已完成作答：可比較選項、解鎖語音完整解析，或輸入問題（每題扣 1 點）。"}</div>{voiceUnlocked && question.audioUrl && <section className="medtech-voice-unlocked"><div><b>本題語音完整解析</b><span>{voiceAccess === "credit" ? "已扣 1 點解鎖" : "免費試聽"} · 剩餘免費試聽 {audioRemaining} 次</span></div><ListeningPlayer compact item={{ id: question.id, title: `第 ${question.questionNumber || question.id} 題語音完整解析`, year: question.year, subject: question.topic || "醫事檢驗", questionText: question.stem, audioUrl: question.audioUrl, subtitles: question.subtitles || [] }} /></section>}<div ref={answerRef} /><section className="medtech-ai-chat" ref={chatRef}>{messages.map((message, index) => <article className={message.role} key={index}><b>{message.role === "mentor" ? "醫檢 AI 助教" : "我"}</b><p>{plainText(message.text)}</p>{message.role === "mentor" && message.source && <small>{message.source}{message.usage ? ` · ${message.usage.model} · ${message.usage.inputTokens + message.usage.outputTokens} tokens · ${(message.usage.durationMs / 1000).toFixed(1)} 秒 · 約 NT$ ${(message.usage.estimatedCostUsd * 32.5).toFixed(3)}` : ""}</small>}</article>)}{loading && <article className="mentor loading"><b>醫檢 AI 助教</b><p>正在整理內容…</p></article>}</section><form onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} disabled={!selectedAnswer || loading} onChange={(event) => setInput(event.target.value)} placeholder={selectedAnswer ? "還想問什麼？每個問題扣 1 點。" : "請先選擇答案，之後才能追問。"} rows={3} /><button disabled={!selectedAnswer || loading || !input.trim()}>送出問題（扣 1 點）</button></form></> : <div className="medtech-ai-empty">{error || "目前沒有可用題目"}</div>}{error && question && <p className="medtech-ai-error">{error}</p>}</section></section>{paywall && <div className="medtech-paywall-backdrop" role="presentation" onMouseDown={() => setPaywall(null)}><section className="medtech-paywall" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>醫檢師會員權益</span><h2>{paywall.title}</h2><p>{paywall.text}</p><div>{paywall.kind === "audio" && <button type="button" className="medtech-paywall-credit" onClick={() => { setPaywall(null); void unlockVoice(true); }}>使用 1 點繼續</button>}<button type="button" onClick={() => setPaywall(null)}>稍後再說</button><a href={paywall.url}>前往付費／會員方案</a></div></section></div>}</main>;
}
