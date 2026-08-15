"use client";

import { useEffect, useRef, useState } from "react";
import { ListeningPlayer } from "../../listening-player";

type Subtitle = { id: number; segmentId: number | null; startSeconds: number; endSeconds: number; text: string; sequence: number };
type Question = { id: number; year: string; stem: string; options: Record<string, string>; answer: string; explanation: string; answerSource: string; topic?: string; questionNumber?: string; audioUrl?: string; subtitles?: Subtitle[] };
type Message = { role: "student" | "mentor"; text: string; source?: string; usage?: { model: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number } };
type Paywall = { title: string; text: string; url: string };
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
  const [audioRemaining, setAudioRemaining] = useState(3);
  const [aiCredits, setAiCredits] = useState(10);
  const [voiceUnlocked, setVoiceUnlocked] = useState(false);
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const chatRef = useRef<HTMLElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  async function loadUsage() {
    const response = await fetch("/api/medtech/usage", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { audioRemaining?: number; aiCredits?: number };
    setAudioRemaining(result.audioRemaining ?? 0);
    setAiCredits(result.aiCredits ?? 0);
  }

  async function loadQuestion(nextTopic = topic) {
    setQuestionLoading(true);
    setError("");
    setSelectedAnswer("");
    setVoiceUnlocked(false);
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
      if (response.status === 402) { setPaywall({ title: "AI 互動點數已用完", text: result.error || "想繼續和醫檢 AI 助教互動，請購買點數或訂閱方案。", url: result.upgradeUrl || "/medtech/upgrade?reason=ai-credits" }); return; }
      if (!response.ok || !result.reply) throw new Error(result.error || "AI 回答失敗");
      setAiCredits(result.creditsRemaining ?? Math.max(0, aiCredits - 1));
      setMessages((current) => [...current, { role: "mentor", text: plainText(result.reply!), source: result.source, usage: result.usage }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 回答失敗");
    } finally {
      setLoading(false);
    }
  }

  async function unlockVoice() {
    if (!question) return;
    if (!question.audioUrl) { setError("這一題尚未上傳語音解析檔，請先選下一題試聽。"); return; }
    try {
      const response = await fetch("/api/medtech/usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "audioTrial", questionId: question.id }) });
      const result = await response.json() as { audioRemaining?: number; error?: string; upgradeUrl?: string };
      if (response.status === 402) { setPaywall({ title: "免費語音試聽已用完", text: result.error || "前三題試聽已使用完畢，訂閱後可繼續收聽完整語音解析。", url: result.upgradeUrl || "/medtech/upgrade?reason=audio-trial" }); return; }
      if (!response.ok) throw new Error(result.error || "語音解析開啟失敗");
      setAudioRemaining(result.audioRemaining ?? audioRemaining);
      setVoiceUnlocked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "語音解析開啟失敗");
    }
  }

  function chooseAnswer(letter: string) { if (loading || selectedAnswer) return; setSelectedAnswer(letter); void send(`我選 ${letter}。請先明確告訴我答對或答錯，再說明判斷關鍵，並逐項解釋其他選項。`); }

  return <main className="medtech-ai-page"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>AI STUDY</small></div></a><nav><a href="/medtech">首頁</a><a href="/medtech/practice">練國考題</a><a href="/medtech/ai-study" className="active">AI 學習</a></nav></header><section className="medtech-ai-shell"><aside className="medtech-ai-settings"><span>醫檢 AI 學習</span><h1>從一道題，真正弄懂一個觀念</h1><p>AI 只讀取醫檢題庫資料，不使用司律教材。</p><div className="medtech-usage-badges"><span>免費語音試聽 <b>{audioRemaining}</b> 題</span><span>AI 互動點數 <b>{aiCredits}</b></span></div><label>我的程度<div>{["入門", "進階", "考前衝刺"].map((item) => <button className={level === item ? "active" : ""} onClick={() => setLevel(item)} key={item}>{item}</button>)}</div></label><label>學習主題<select value={topic} onChange={(event) => { setTopic(event.target.value); void loadQuestion(event.target.value); }}><option value="">全部主題</option>{topics.map((item) => <option key={item}>{item}</option>)}</select></label><button className="medtech-new-question" onClick={() => void loadQuestion()} disabled={questionLoading}>換一道題</button><small>教材未附解析時，回答會明確標示為 AI 補充，不會冒充教材原文。</small></aside><section className="medtech-ai-workspace">{questionLoading ? <div className="medtech-ai-empty">正在從正式題庫抽題…</div> : question ? <><article className="medtech-ai-question"><header><span>{question.topic || topic || "臨床病毒學"}</span><small>{question.year} 年專技</small></header><h2>{question.stem}</h2><div>{Object.entries(question.options).map(([key, value]) => <button type="button" disabled={loading || Boolean(selectedAnswer)} className={selectedAnswer === key ? "selected" : ""} onClick={() => chooseAnswer(key)} key={key}><b>{key}</b><span>{value}</span>{selectedAnswer === key && <em>已選擇</em>}</button>)}</div><small className="medtech-answer-hint">直接點選答案，AI 會判斷正誤並說明。</small></article><div className="medtech-ai-quick"><button onClick={() => void send("先不要公布答案，請給我一個判斷提示。")}>給我提示</button><button onClick={() => void send("請逐項比較四個選項，但先讓我看懂判斷關鍵。")}>比較選項</button><button className="voice-explanation-button" onClick={() => void unlockVoice()}>語音解析</button></div>{voiceUnlocked && question.audioUrl && <section className="medtech-voice-unlocked"><div><b>本題語音解析</b><span>已開啟試聽 · 剩餘免費試聽 {audioRemaining} 題</span></div><ListeningPlayer compact item={{ id: question.id, title: `第 ${question.questionNumber || question.id} 題語音解析`, year: question.year, subject: question.topic || "醫事檢驗", questionText: question.stem, audioUrl: question.audioUrl, subtitles: question.subtitles || [] }} /></section>}<div ref={answerRef} /><section className="medtech-ai-chat" ref={chatRef}>{messages.map((message, index) => <article className={message.role} key={index}><b>{message.role === "mentor" ? "醫檢 AI 助教" : "我"}</b><p>{plainText(message.text)}</p>{message.role === "mentor" && message.source && <small>{message.source}{message.usage ? ` · ${message.usage.model} · ${message.usage.inputTokens + message.usage.outputTokens} tokens · ${(message.usage.durationMs / 1000).toFixed(1)} 秒 · 約 NT$ ${(message.usage.estimatedCostUsd * 32.5).toFixed(3)}` : ""}</small>}</article>)}{loading && <article className="mentor loading"><b>醫檢 AI 助教</b><p>正在核對答案並整理解析…</p></article>}</section><form onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：為什麼 B 才是正確答案？其他選項錯在哪裡？" rows={3} /><button disabled={loading || !input.trim()}>送出問題</button></form></> : <div className="medtech-ai-empty">{error || "目前沒有可用題目"}</div>}{error && question && <p className="medtech-ai-error">{error}</p>}</section></section>{paywall && <div className="medtech-paywall-backdrop" role="presentation" onMouseDown={() => setPaywall(null)}><section className="medtech-paywall" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>醫檢師會員權益</span><h2>{paywall.title}</h2><p>{paywall.text}</p><div><button type="button" onClick={() => setPaywall(null)}>稍後再說</button><a href={paywall.url}>前往訂閱／購買點數</a></div></section></div>}</main>;
}
