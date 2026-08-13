"use client";

import { FormEvent, useRef, useState } from "react";

type Message = { role: "student" | "mentor"; text: string; source?: string; usage?: { model: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number } };

const starters = ["收入認列五步驟怎麼判斷？", "請帶我拆解金融資產分類", "折舊、減損與重估差在哪裡？"];

export default function AccountingCoach() {
  const [messages, setMessages] = useState<Message[]>([{ role: "mentor", text: "把題目、計算過程或看不懂的觀念貼上來。我會先確認題目要求與已知條件，再陪你逐步核算。" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function send(value = input) {
    const text = value.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "student" as const, text }];
    setMessages(next); setInput(""); setError(""); setLoading(true);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    try {
      const response = await fetch("/api/accounting/tutor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const result = await response.json() as { reply?: string; source?: string; usage?: Message["usage"]; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error || "中會 AI 暫時無法回答");
      setMessages((current) => [...current, { role: "mentor", text: result.reply!, source: result.source, usage: result.usage }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "中會 AI 暫時無法回答"); }
    finally { setLoading(false); requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })); }
  }

  return <section className="accounting-coach" id="accounting-coach">
    <header><div><span>中會 AI 教練</span><h2>從觀念到計算，每一步都要能核對</h2></div><small>只檢索已開放的中級會計教材</small></header>
    <div className="accounting-chat" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "中會 AI 教練" : "我"}</b><p>{message.text}</p>{message.role === "mentor" && message.source && <small>{message.source}{message.usage ? ` · ${message.usage.model} · ${message.usage.inputTokens + message.usage.outputTokens} tokens · ${(message.usage.durationMs / 1000).toFixed(1)} 秒 · 約 NT$ ${(message.usage.estimatedCostUsd * 32.5).toFixed(3)}` : ""}</small>}</article>)}{loading && <article className="mentor loading"><b>中會 AI 教練</b><p>正在整理條件、準則與計算步驟…</p></article>}<div ref={endRef} /></div>
    <div className="accounting-starters">{starters.map((starter) => <button type="button" onClick={() => void send(starter)} disabled={loading} key={starter}>{starter}</button>)}</div>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }}><textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder="輸入觀念、題目或你的計算過程…" /><button disabled={loading || !input.trim()}>送出</button></form>
    {error && <p className="accounting-chat-error">{error}</p>}
  </section>;
}
