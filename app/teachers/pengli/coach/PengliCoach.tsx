"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type CoachMessage = { role: "student" | "coach" | "scholar"; text: string; source?: string };
type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsd: number };
type Access = { charged?: boolean; remaining?: number | null; coachRoundsUsed?: number | null; coachRoundsTarget?: number };
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
  const [scholarThinking, setScholarThinking] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [scholarAssistEnabled, setScholarAssistEnabled] = useState(true);
  const [chatMaximized, setChatMaximized] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as CoachMessage[] | null;
      if (Array.isArray(saved) && saved.length) setMessages(saved.slice(-40));
      const topic = new URLSearchParams(window.location.search).get("topic");
      if (topic) setInput(`我正在學「${topic}」，請先用一個問題帶我判斷。`);
    } catch { /* 使用預設歡迎訊息 */ }
  }, []);

  useEffect(() => { void fetch("/api/ai-access", { cache: "no-store" }).then(async response => response.ok ? response.json() : null).then(data => { if (data?.aiAccess) setAccess({ remaining: data.aiAccess.remaining, coachRoundsUsed: data.aiAccess.coachRoundsUsed, coachRoundsTarget: data.aiAccess.coachRoundsTarget }); if (data?.plan) setScholarAssistEnabled(data.plan.scholarAssistEnabled !== false); }).catch(() => undefined); }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const hasConversation = useMemo(() => messages.some((message) => message.role === "student"), [messages]);

  async function requestCoach(next: CoachMessage[]) {
    const response = await fetch("/api/teachers/pengli/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: next.slice(-12), requestKey: crypto.randomUUID() }),
    });
    const data = await response.json() as { reply?: string; source?: string; error?: string; usage?: Usage; access?: Access; purchaseUrl?: string };
    if (!response.ok || !data.reply) {
      if (data.purchaseUrl) window.location.href = "/teachers/pengli/ai-access";
      throw new Error(data.error || "彭狸 AI 教練目前無法回答。");
    }
    setMessages((current) => [...current, { role: "coach", text: data.reply!, source: data.source }]);
    setUsage(data.usage || null);
    if (data.access) setAccess(data.access);
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!question || thinking || scholarThinking) return;
    const next = [...messages, { role: "student" as const, text: question }];
    setMessages(next);
    setInput("");
    setThinking(true);
    setError("");
    try {
      await requestCoach(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "彭狸 AI 教練目前無法回答。");
    } finally {
      setThinking(false);
    }
  }

  async function askScholarToAnswer() {
    if (thinking || scholarThinking) return;
    const latestCoach = [...messages].reverse().find((message) => message.role === "coach");
    if (!latestCoach) return;
    setScholarThinking(true);
    setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "scholar-assist", messages: messages.slice(-12) }),
      });
      const data = await response.json() as { scholarDraft?: string; error?: string; purchaseUrl?: string };
      if (!response.ok || !data.scholarDraft) {
        if (data.purchaseUrl) window.location.href = "/teachers/pengli/ai-access";
        throw new Error(data.error || "AI 學霸目前無法代答。");
      }
      const next = [...messages, { role: "scholar" as const, text: data.scholarDraft, source: "學霸代答（學生角色）" }];
      setMessages(next);
      setScholarThinking(false);
      setThinking(true);
      await requestCoach(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 學霸目前無法代答。");
    } finally {
      setScholarThinking(false);
      setThinking(false);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(input); }

  return <section className={`pengli-coach-shell${chatMaximized ? " chat-maximized" : ""}`}>
    <aside className="pengli-coach-sidebar">
      <div className="pengli-coach-identity">
        <img src="https://publish.get.com.tw/Publish/Control/pictures/Book/59ML170502.gif" alt="行政法考點演習書" />
        <div><small>彭狸老師專屬</small><strong>行政法 AI 教練</strong><span>教材優先・引導作答</span></div>
      </div>
      <div className="pengli-coach-scope"><b>目前教材範圍</b><span>行政法 8 大主題</span><span>試學考點與解題脈絡</span><span>老師提醒與作答架構</span></div>
      <div className="pengli-coach-rule"><b>回答原則</b><p>不混用其他老師教材。超出彭狸教材索引時，會明確標示「AI 補充」，不冒充老師原文。</p></div>
      <div className="pengli-coach-access"><b>AI 陪練次數</b><strong>{access?.remaining ?? "—"} 次</strong><span>完成 5 輪才扣 1 次</span><a href="/teachers/pengli/ai-access">購買／輸入兌換碼</a></div>
      <button type="button" onClick={() => { setMessages([{ role: "coach", text: "新的練習開始了。請貼上行政法題目，或告訴我你正在讀哪一個考點。", source: "彭狸 AI 教練" }]); setUsage(null); setError(""); }}>＋ 另開練習</button>
    </aside>

    <div className="pengli-coach-main">
      <button type="button" className="pengli-chat-maximize" aria-pressed={chatMaximized} onClick={() => setChatMaximized((value) => !value)}>{chatMaximized ? "退出最大化" : "⛶ 最大化對話"}</button>
      <header><div><span>彭狸 AI 教練</span><h1>先找爭點，再把答案寫出來</h1></div><i><b /> 教材模式</i></header>
      <div className="pengli-coach-thread" aria-live="polite">
        {!hasConversation && <div className="pengli-coach-starters">{starters.map((starter) => <button type="button" key={starter} onClick={() => void ask(starter)}>{starter}<b>→</b></button>)}</div>}
        {messages.map((message, index) => <article data-selection-scope="pengli" data-selection-source={message.source || ""} className={message.role === "coach" ? "coach" : "student"} key={`${message.role}-${index}`}>
          <div className="pengli-coach-avatar">{message.role === "coach" ? "狸" : "我"}</div>
          <div><small>{message.role === "coach" ? "彭狸 AI 教練" : message.role === "scholar" ? "我的回答（學霸幫我答）" : "我的問題"}</small><p>{message.text}</p>{message.source && <span>（根據《{message.source}）</span>}</div>
        </article>)}
        {scholarThinking && <article className="student thinking"><div className="pengli-coach-avatar">我</div><div><small>我的回答（學霸幫我答）</small><p>正在替我整理回答與要問老師的問題……</p></div></article>}
        {thinking && <article className="coach thinking"><div className="pengli-coach-avatar">狸</div><div><small>彭狸 AI 教練</small><p>正在回應學員的回答與追問……</p></div></article>}
        <div ref={endRef} />
      </div>
      {error && <p className="pengli-coach-error">{error}</p>}
      {scholarAssistEnabled && <div className="pengli-coach-assist">
        <button type="button" onClick={() => void askScholarToAnswer()} disabled={thinking || scholarThinking || !messages.some((message) => message.role === "coach")}>
          <b>霸</b><span><strong>學霸幫我回答</strong><small>我不知道時，代我回答並反問老師</small></span>
        </button>
      </div>}
      <form className="pengli-coach-composer" onSubmit={submit}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={2} placeholder="貼上行政法題目，或告訴我你卡在哪個爭點……" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(input); } }} />
        <button type="submit" disabled={!input.trim() || thinking || scholarThinking}>送出</button>
      </form>
      <footer><span>AI 分身不等同真人老師；每完成 5 輪陪練扣 1 次。</span><small>{access?.coachRoundsUsed ?? 0}／{access?.coachRoundsTarget ?? 5} 輪・剩餘 {access?.remaining ?? "—"} 次</small></footer>
    </div>
  </section>;
}
