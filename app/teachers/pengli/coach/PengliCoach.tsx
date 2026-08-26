"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type CoachMessage = { role: "student" | "coach"; text: string; source?: string };
type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsd: number };
const storageKey = "pengli-ai-coach-history-v1";

const starters = [
  "本題為什麼要先判斷請求權基礎？",
  "法律保留原則的作答架構怎麼寫？",
  "幫我練習判斷行政處分的外部性。",
];

export default function PengliCoach() {
  const [messages, setMessages] = useState<CoachMessage[]>([{ role: "coach", text: "我是彭狸 AI 教練。這裡只依彭狸老師《行政法考點（考前衝刺）演習書》的學習脈絡陪你練習；我會先幫你找爭點與破題方向，不會一開始就把整份擬答貼給你。", source: "專區使用說明" }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as CoachMessage[] | null;
      if (Array.isArray(saved) && saved.length) setMessages(saved.slice(-40));
      const topic = new URLSearchParams(window.location.search).get("topic");
      if (topic) setInput(`我正在學「${topic}」，請先用一個問題帶我判斷。`);
    } catch { /* 使用預設歡迎訊息 */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const hasConversation = useMemo(() => messages.some((message) => message.role === "student"), [messages]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || thinking) return;
    const next = [...messages, { role: "student" as const, text: question }];
    setMessages(next);
    setInput("");
    setThinking(true);
    setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const data = await response.json() as { reply?: string; source?: string; error?: string; usage?: Usage };
      if (!response.ok || !data.reply) throw new Error(data.error || "彭狸 AI 教練目前無法回答。");
      setMessages((current) => [...current, { role: "coach", text: data.reply!, source: data.source }]);
      setUsage(data.usage || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "彭狸 AI 教練目前無法回答。");
    } finally {
      setThinking(false);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(input); }

  return <section className="pengli-coach-shell">
    <aside className="pengli-coach-sidebar">
      <div className="pengli-coach-identity">
        <img src="/teachers/pengli-administrative-law-cover.png" alt="行政法考點演習書" />
        <div><small>彭狸老師專屬</small><strong>行政法 AI 教練</strong><span>教材優先・引導作答</span></div>
      </div>
      <div className="pengli-coach-scope"><b>目前教材範圍</b><span>行政法 8 大主題</span><span>試學考點與解題脈絡</span><span>老師提醒與作答架構</span></div>
      <div className="pengli-coach-rule"><b>回答原則</b><p>不混用其他老師教材。超出彭狸教材索引時，會明確標示「AI 補充」，不冒充老師原文。</p></div>
      <button type="button" onClick={() => { setMessages([{ role: "coach", text: "新的練習開始了。請貼上行政法題目，或告訴我你正在讀哪一個考點。", source: "彭狸 AI 教練" }]); setUsage(null); setError(""); }}>＋ 另開練習</button>
    </aside>

    <div className="pengli-coach-main">
      <header><div><span>彭狸 AI 教練</span><h1>先找爭點，再把答案寫出來</h1></div><i><b /> 教材模式</i></header>
      <div className="pengli-coach-thread" aria-live="polite">
        {!hasConversation && <div className="pengli-coach-starters">{starters.map((starter) => <button type="button" key={starter} onClick={() => void ask(starter)}>{starter}<b>→</b></button>)}</div>}
        {messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}>
          <div className="pengli-coach-avatar">{message.role === "coach" ? "狸" : "我"}</div>
          <div><small>{message.role === "coach" ? "彭狸 AI 教練" : "我的問題"}</small><p>{message.text}</p>{message.source && <span>依據：{message.source}</span>}</div>
        </article>)}
        {thinking && <article className="coach thinking"><div className="pengli-coach-avatar">狸</div><div><small>彭狸 AI 教練</small><p>正在依老師教材脈絡整理問題……</p></div></article>}
        <div ref={endRef} />
      </div>
      {error && <p className="pengli-coach-error">{error}</p>}
      <form className="pengli-coach-composer" onSubmit={submit}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={2} placeholder="貼上行政法題目，或告訴我你卡在哪個爭點……" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(input); } }} />
        <button type="submit" disabled={!input.trim() || thinking}>送出</button>
      </form>
      <footer><span>AI 分身不等同真人老師；老師原文與 AI 補充會分開標示。</span>{usage && <small>{usage.inputTokens + usage.outputTokens} tokens・估算成本 US$ {usage.estimatedCostUsd.toFixed(5)}</small>}</footer>
    </div>
  </section>;
}
