"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Member = "luna" | "deepseek" | "terra" | "sol";
type Target = Member | "host" | "free";
type Mood = "quiet" | "natural" | "lively";
type Message = { id: number; speaker: "student" | "host" | Member; text: string; model?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; quote?: string };

const memberInfo: Array<{ id: Member; name: string; mark: string; title: string; detail: string }> = [
  { id: "luna", name: "Luna", mark: "月", title: "白話拆解派", detail: "像初學同學，敢問笨問題，用生活例子把基本概念說懂。" },
  { id: "deepseek", name: "DeepSeek", mark: "尋", title: "資料整理派", detail: "擅長補充法條、學說與不同觀點，幫大家把資料排整齊。" },
  { id: "terra", name: "Terra", mark: "辯", title: "質疑吐槽派", detail: "專找推論漏洞、遺漏要件與反例；尖銳，但不攻擊人。" },
  { id: "sol", name: "Sol", mark: "日", title: "學霸統整派", detail: "校準法律錯誤，最後整理成爭點、規範、涵攝與結論。" },
];
const labels: Record<Message["speaker"], string> = { student: "我", host: "主持人", luna: "Luna", deepseek: "DeepSeek", terra: "Terra", sol: "Sol" };

export default function StudyGroup() {
  const [tasks, setTasks] = useState<Array<{ title: string; subject: string; details: string; status: string }>>([]);
  const [customTopic, setCustomTopic] = useState("");
  const [target, setTarget] = useState<Target>("host");
  const [mood, setMood] = useState<Mood>("natural");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Message | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);

  const todayGoal = useMemo(() => tasks.find((task) => task.status !== "completed"), [tasks]);
  const topic = customTopic.trim() || (todayGoal ? `${todayGoal.subject}｜${todayGoal.title}` : "今日推薦：信賴原則的適用界線");

  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const date = `${month}-${String(now.getDate()).padStart(2, "0")}`;
    fetch(`/api/study-plan?month=${month}`).then((res) => res.ok ? res.json() : null).then((data) => setTasks((data?.tasks || []).filter((task: { taskDate?: string }) => task.taskDate === date))).catch(() => undefined);
    const saved = window.localStorage.getItem("silu-study-group-current");
    if (saved) try { const parsed = JSON.parse(saved) as { messages?: Message[]; topic?: string; mood?: Mood }; setMessages(parsed.messages || []); setCustomTopic(parsed.topic || ""); setMood(parsed.mood || "natural"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { window.localStorage.setItem("silu-study-group-current", JSON.stringify({ messages, topic: customTopic, mood })); }, [messages, customTopic, mood]);

  function begin() {
    setIntroOpen(false);
    if (messages.length) return;
    setMessages([{ id: Date.now(), speaker: "host", text: `今天就從「${topic}」開始。先不用急著找標準答案：你目前怎麼理解？哪一點最不確定？` }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    const text = input.trim();
    const student: Message = { id: Date.now(), speaker: "student", text, quote: quote ? `${labels[quote.speaker]}：${quote.text.slice(0, 90)}` : undefined };
    const next = [...messages, student];
    setMessages(next); setInput(""); setQuote(null); setBusy(true);
    const direct = text.match(/@(Luna|DeepSeek|Terra|Sol)/i)?.[1];
    const chosen = direct ? direct.toLowerCase() as Member : target;
    setMessages((current) => [...current, { id: Date.now() + 1, speaker: "host", text: chosen === "host" ? "我來判斷最適合的成員先回答；其他人只有在有補充理由時才接話。" : chosen === "free" ? "開放自由討論，但這一輪最多兩位成員發言。" : `先請 ${labels[chosen]} 回答。` }]);
    try {
      const response = await fetch("/api/study-group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: quote ? `針對「${quote.text}」：${text}` : text, target: chosen, mood, topic, messages: next.map((item) => ({ speaker: labels[item.speaker], text: item.text })) }) });
      const result = await response.json() as { replies?: Array<{ speaker: Member; text: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }>; error?: string };
      if (!response.ok) throw new Error(result.error || "讀書會暫時無法回應");
      setMessages((current) => [...current, ...(result.replies || []).map((item, index) => ({ id: Date.now() + index + 2, ...item }))]);
    } catch (error) {
      setMessages((current) => [...current, { id: Date.now() + 4, speaker: "host", text: error instanceof Error ? error.message : "讀書會暫時無法回應。" }]);
    } finally { setBusy(false); }
  }

  return <main className="study-group-shell">
    <header className="study-group-top"><Link href="/" className="study-group-brand"><span>律</span><b>司律備考</b></Link><div><span>AI 讀書會</span><Link href="/plan">今日學習目標</Link><Link href="/">回作戰中心</Link></div></header>
    <section className="study-group-heading"><div><span>AI STUDY CIRCLE</span><h1>像真的同學一樣，一起把問題聊懂。</h1><p>你可以直接點名、交給主持人派話，或讓其他成員有條件地自然插話。</p></div><aside><small>本次主題</small><b>{topic}</b><button type="button" onClick={() => setIntroOpen(true)}>更換主題</button></aside></section>

    {introOpen && <section className="study-group-intro" aria-label="讀書會成員與主題設定"><header><div><span>進場前先認識今天的同學</span><h2>四位成員，各有不同程度與任務</h2></div><button type="button" onClick={() => setIntroOpen(false)}>收合</button></header><div className="study-group-members">{memberInfo.map((member) => <article className={member.id} key={member.id}><i>{member.mark}</i><div><b>{member.name}</b><span>{member.title}</span><p>{member.detail}</p></div></article>)}</div><div className="study-group-topic"><div><small>不知道主題也沒關係</small><b>{todayGoal ? `已讀取今日尚未完成目標：${todayGoal.subject}｜${todayGoal.title}` : "今天沒有可用任務，先提供每日推薦主題"}</b></div><label>自訂主題<input value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder="例如：不作為犯的保證人地位" /></label><button type="button" onClick={begin}>進入讀書會</button></div><p className="study-group-disclaimer">四位成員都是 AI 角色，可能犯錯；重要法律結論仍應回到法條、實務與指定教材核對。</p></section>}

    <div className="study-group-layout"><aside className="study-group-controls"><section><span>想問誰？</span>{([['host','主持人決定'],['luna','Luna 白話'],['deepseek','DeepSeek 補充'],['terra','Terra 質疑'],['sol','Sol 統整'],['free','自由討論']] as Array<[Target,string]>).map(([id,label]) => <button type="button" className={target === id ? "active" : ""} onClick={() => setTarget(id)} key={id}>{label}</button>)}</section><section><span>討論氣氛</span>{([['quiet','安靜'],['natural','自然'],['lively','熱烈']] as Array<[Mood,string]>).map(([id,label]) => <button type="button" className={mood === id ? "active" : ""} onClick={() => setMood(id)} key={id}>{label}</button>)}<small>{mood === "quiet" ? "只有被指定者回答" : mood === "natural" ? "必要時一位成員補充" : "允許質疑與二輪回應"}</small></section><button className="study-group-new" type="button" onClick={() => { setMessages([]); setCustomTopic(""); setIntroOpen(true); }}>＋ 另開讀書會</button></aside>
      <section className="study-group-chat"><div className="study-group-messages">{messages.length === 0 && <div className="study-group-empty"><b>主持人還在等你入席</b><span>確認主題後進入，或直接在下方開始發言。</span></div>}{messages.map((message) => <article className={`study-group-message ${message.speaker}`} key={message.id}><div className="study-group-avatar">{message.speaker === "student" ? "我" : message.speaker === "host" ? "持" : memberInfo.find((item) => item.id === message.speaker)?.mark}</div><div><header><b>{labels[message.speaker]}</b>{message.model && <small>{message.model} · {(message.inputTokens || 0) + (message.outputTokens || 0)} tokens · {(message.durationMs || 0).toLocaleString()} ms</small>}</header>{message.quote && <blockquote>{message.quote}</blockquote>}<p>{message.text}</p>{message.speaker !== "student" && message.speaker !== "host" && <footer><button type="button" onClick={() => setQuote(message)}>引用回覆</button><button type="button" onClick={() => { setTarget("terra"); setQuote(message); setInput(`@Terra，請質疑 ${labels[message.speaker]} 這段說法：`); }}>請 Terra 質疑</button>{message.speaker !== "sol" && <button type="button" onClick={() => { setTarget("sol"); setQuote(message); setInput("@Sol，請幫我校準並統整："); }}>請 Sol 統整</button>}</footer>}</div></article>)}{busy && <article className="study-group-message host"><div className="study-group-avatar">持</div><div><p className="study-group-typing">成員正在整理想法<span>•••</span></p></div></article>}</div><form onSubmit={submit}>{quote && <div className="study-group-quote"><span>正在回覆 {labels[quote.speaker]}：{quote.text.slice(0, 72)}</span><button type="button" onClick={() => setQuote(null)}>×</button></div>}<textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="直接發言，或輸入 @Luna、@DeepSeek、@Terra、@Sol 點名…" rows={3} /><div><span>目前：{target === "host" ? "主持人派話" : target === "free" ? "自由討論" : `指定 ${labels[target]}`} · {mood === "quiet" ? "安靜模式" : mood === "natural" ? "自然模式" : "熱烈模式"}</span><button disabled={busy || !input.trim()}>{busy ? "討論中…" : "送出發言"}</button></div></form></section>
    </div>
  </main>;
}
