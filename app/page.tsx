"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "mentor" | "student"; text: string };
type ReplyUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsd: number };
type TodayTask = { id: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type DashboardData = { targetLabel: string; monthsRemaining: number; officialDatePending: boolean; todayProgress: { completed: number; total: number }; record: { completedTasks: number; completedMinutes: number; totalTasks: number }; priorities: Array<{ subject: string; count: number; reason: string }>; memo: string; encouragement: string };

const quickStarts = ["帶我開始今天的刑法", "我想練一題司律真題", "幫我複習不作為犯"];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [today, setToday] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [memo, setMemo] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [source, setSource] = useState<"教材" | "AI 補充" | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [lastUsage, setLastUsage] = useState<ReplyUsage | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
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
        setMessages([{ role: "mentor", text: "早安，我是你的司律導師。今天還沒有安排任務，我可以先根據你的目標與可用時間，幫你建立第一份讀書計畫。" }]);
      }
    }).catch(() => {
      setMessages([{ role: "mentor", text: "早安，我是你的司律導師。今天想從哪一科開始？" }]);
    }).finally(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => {
    fetch("/api/dashboard").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as DashboardData;
      setDashboard(data); setMemo(data.memo ?? "");
    }).catch(() => undefined);
  }, []);

  async function saveMemo() {
    const response = await fetch("/api/dashboard", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memo }) });
    if (response.ok) { setMemoSaved(true); window.setTimeout(() => setMemoSaved(false), 1500); }
  }

  useEffect(() => {
    fetch("/api/usage").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { showCosts?: boolean };
      setShowCosts(Boolean(data.showCosts));
    }).catch(() => undefined);
  }, []);

  async function send(text: string) {
    const value = text.trim();
    if (!value || thinking) return;
    const nextMessages: Message[] = [...messages, { role: "student", text: value }];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12), sessionId }),
      });
      const result = await response.json() as { reply?: string; source?: "教材" | "AI 補充"; usage?: ReplyUsage; sessionId?: number; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "對話暫時無法使用");
      setMessages((current) => [...current, { role: "mentor", text: result.reply! }]);
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

  return (
    <main className="coach-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="司律導師首頁">
          <span className="brand-mark">律</span>
          <span>司律導師</span>
        </Link>
        <div className="top-actions">
          <span className="knowledge-state"><i /> 教材知識庫準備中</span>
          <Link href="/plan" className="admin-link">讀書計畫</Link>
          <Link href="/admin" className="admin-link">管理後台</Link>
        </div>
      </header>

      <div className="command-layout">
      <section className="conversation" aria-live="polite">
        <div className="conversation-heading">
          <p>AI 司律作戰中心</p>
          <h1>今天，照計畫前進。</h1>
          <span>我會讀取你的計畫、進度與教材，接著上次的地方帶你學。</span>
        </div>

        {todayTasks.length > 0 && <section className="today-plan-card">
          <div className="today-plan-head"><div><p>今日讀書計畫</p><strong>{today || "今天"}</strong></div><Link href="/plan">查看行事曆 →</Link></div>
          <div className="today-task-list">{todayTasks.map((task) => <div className={`today-task ${task.status === "completed" ? "done" : ""}`} key={task.id}><span>{task.status === "completed" ? "✓" : ""}</span><div><strong>{task.subject} · {task.title}</strong><small>{task.durationMinutes} 分鐘{task.details ? ` · ${task.details}` : ""}</small></div></div>)}</div>
          {todayTasks.some((task) => task.status !== "completed") && <button onClick={() => send(`請直接帶我開始今天第一個尚未完成的任務：${todayTasks.find((task) => task.status !== "completed")?.title}`)}>開始今日第一項</button>}
        </section>}

        <div className="message-list">
          {!historyLoaded && <div className="message-row mentor"><span className="mentor-avatar">律</span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === "mentor" && <span className="mentor-avatar">律</span>}
              <div className="message-bubble">{message.text}</div>
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
        <section className="countdown-card"><span>司律目標</span><strong>{dashboard?.monthsRemaining ?? "—"}<small>個月</small></strong><p>{dashboard?.targetLabel ?? "2027 年 8 月"}</p><em>正式日期待公布</em></section>
        <section className="rail-card progress-card"><div className="rail-title"><strong>今日戰況</strong><Link href="/plan">行事曆</Link></div><div className="progress-number"><b>{dashboard?.todayProgress.completed ?? 0}</b><span>／{dashboard?.todayProgress.total ?? 0} 項</span></div><div className="progress-track"><i style={{ width: `${dashboard?.todayProgress.total ? Math.round(dashboard.todayProgress.completed / dashboard.todayProgress.total * 100) : 0}%` }} /></div><p>{dashboard?.encouragement ?? "把專注留給今天。"}</p></section>
        <section className="rail-card"><div className="rail-title"><strong>學習紀錄</strong></div><div className="record-grid"><div><b>{dashboard?.record.completedTasks ?? 0}</b><span>完成任務</span></div><div><b>{Math.round((dashboard?.record.completedMinutes ?? 0) / 60 * 10) / 10}</b><span>累計小時</span></div></div></section>
        <section className="rail-card"><div className="rail-title"><strong>優先補強</strong></div>{dashboard?.priorities.length ? <div className="priority-list">{dashboard.priorities.map((item) => <div key={item.subject}><span>{item.subject}</span><small>{item.reason}</small></div>)}</div> : <p className="rail-empty">目前沒有逾期任務。完成更多練習後，這裡會進一步分析爭點弱項。</p>}</section>
        <section className="memo-card"><div className="memo-tape" /><strong>給今天的自己</strong><textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="記下提醒、老師交代或今天一定要完成的事…" rows={4} /><button onClick={saveMemo}>{memoSaved ? "已儲存 ✓" : "儲存 MEMO"}</button></section>
      </aside>
      </div>

      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
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
          <button type="submit" aria-label="送出" disabled={!input.trim() || thinking}>↑</button>
        </form>
        <p>教材優先檢索 · 找不到時由 AI 補充並清楚標示</p>
      </div>
    </main>
  );
}
