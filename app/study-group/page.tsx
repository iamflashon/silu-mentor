"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Member = "luna" | "deepseek" | "terra" | "sol";
type Target = Member | "host" | "free";
type Mood = "quiet" | "natural" | "lively";
type StudentLevel = "beginner" | "intermediate" | "advanced";
type Message = {
  id: number;
  speaker: "student" | "host" | Member;
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  quote?: string;
  challengedSpeaker?: Member;
  imageUrl?: string;
};
type StudyGroupSession = {
  id: number;
  topic: string;
  mood: Mood;
  updatedAt: string;
  messages: Message[];
};

const memberInfo: Array<{
  id: Member;
  name: string;
  mark: string;
  title: string;
  detail: string;
}> = [
  {
    id: "luna",
    name: "Luna",
    mark: "月",
    title: "白話拆解派",
    detail: "像初學同學，敢問笨問題，用生活例子把基本概念說懂。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    mark: "尋",
    title: "資料整理派",
    detail: "擅長補充法條、學說與不同觀點，幫大家把資料排整齊。",
  },
  {
    id: "terra",
    name: "Terra",
    mark: "辯",
    title: "質疑吐槽派",
    detail: "專找推論漏洞、遺漏要件與反例；尖銳，但不攻擊人。",
  },
  {
    id: "sol",
    name: "Sol",
    mark: "日",
    title: "學霸統整派",
    detail: "校準法律錯誤，最後整理成爭點、規範、涵攝與結論。",
  },
];
const labels: Record<Message["speaker"], string> = {
  student: "我",
  host: "主持人",
  luna: "Luna",
  deepseek: "DeepSeek",
  terra: "Terra",
  sol: "Sol",
};

function cleanMarkdown(text: string) {
  return text
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*+/g, "")
    .trim();
}

function challengedMember(message: Message): Member | null {
  if (message.challengedSpeaker) return message.challengedSpeaker;
  const named = message.text.match(/(?:質疑|懷疑|挑戰)\s*(Luna|DeepSeek|Sol)/i)?.[1];
  return named ? (named.toLowerCase() as Member) : null;
}

export default function StudyGroup() {
  const [tasks, setTasks] = useState<
    Array<{ title: string; subject: string; details: string; status: string }>
  >([]);
  const [customTopic, setCustomTopic] = useState("");
  const [target, setTarget] = useState<Target>("host");
  const [mood, setMood] = useState<Mood>("natural");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Message | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [history, setHistory] = useState<StudyGroupSession[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [imageDraft, setImageDraft] = useState<{ url: string; dataUrl: string; name: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<number | null>(null);
  const historyLoadedRef = useRef(false);

  const todayGoal = useMemo(
    () => tasks.find((task) => task.status !== "completed"),
    [tasks],
  );
  const topic =
    customTopic.trim() ||
    (todayGoal
      ? `${todayGoal.subject}｜${todayGoal.title}`
      : "今日推薦：信賴原則的適用界線");

  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const date = `${month}-${String(now.getDate()).padStart(2, "0")}`;
    fetch(`/api/study-plan?month=${month}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setTasks(
          (data?.tasks || []).filter(
            (task: { taskDate?: string }) => task.taskDate === date,
          ),
        ),
      )
      .catch(() => undefined);
    const saved = window.localStorage.getItem("silu-study-group-current");
    if (saved)
      try {
        const parsed = JSON.parse(saved) as {
          messages?: Message[];
          topic?: string;
          mood?: Mood;
        };
        setMessages(parsed.messages || []);
        setCustomTopic(parsed.topic || "");
        setMood(parsed.mood || "natural");
      } catch {
        /* ignore */
      }
    fetch("/api/study-group/history")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const sessions = (data?.sessions || []) as StudyGroupSession[];
        setHistory(sessions);
        if (sessions[0]) {
          sessionIdRef.current = sessions[0].id;
          setSessionId(sessions[0].id);
          setMessages(sessions[0].messages || []);
          setCustomTopic(sessions[0].topic || "");
          setMood(sessions[0].mood || "natural");
          setIntroOpen(false);
        }
        historyLoadedRef.current = true;
      })
      .catch(() => {
        historyLoadedRef.current = true;
      });
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      "silu-study-group-current",
      JSON.stringify({ messages, topic: customTopic, mood }),
    );
  }, [messages, customTopic, mood]);
  useEffect(() => {
    if (!historyLoadedRef.current || messages.length === 0) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/study-group/history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            topic,
            mood,
            messages,
          }),
        });
        const result = (await response.json()) as { sessionId?: number };
        if (!response.ok || !result.sessionId) return;
        sessionIdRef.current = result.sessionId;
        setSessionId(result.sessionId);
        setHistory((current) => {
          const saved: StudyGroupSession = {
            id: result.sessionId!,
            topic,
            mood,
            updatedAt: new Date().toISOString(),
            messages,
          };
          return [saved, ...current.filter((item) => item.id !== result.sessionId)].slice(0, 80);
        });
      } catch {
        /* local copy remains available */
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [messages, mood, topic]);

  function openSession(session: StudyGroupSession) {
    sessionIdRef.current = session.id;
    setSessionId(session.id);
    setMessages(session.messages || []);
    setCustomTopic(session.topic);
    setMood(session.mood || "natural");
    setQuote(null);
    setIntroOpen(false);
  }

  function begin() {
    setIntroOpen(false);
    if (messages.length) return;
    setMessages([
      {
        id: Date.now(),
        speaker: "host",
        text: `今天就從「${topic}」開始。先不用急著找標準答案：你目前怎麼理解？哪一點最不確定？`,
      },
    ]);
  }

  function fillSimulation(level: StudentLevel) {
    const prompts: Record<StudentLevel, string> = {
      beginner: `我對「${topic}」還沒有概念。可以先不要用太多法律術語，用一個生活例子告訴我它在判斷什麼嗎？`,
      intermediate: `我理解「${topic}」的基本概念，但還不確定構成要件與適用界線。可以給我一個容易判錯的案例，讓我先試著判斷嗎？`,
      advanced: `針對「${topic}」，我想檢驗實務與學說可能分歧的判準。請先提出一個有灰色地帶的案例，再質疑我的論證，最後才由 Sol 校準成二試答題架構。`,
    };
    setTarget(
      level === "beginner"
        ? "luna"
        : level === "intermediate"
          ? "host"
          : "free",
    );
    setMood(level === "advanced" ? "lively" : "natural");
    setInput(prompts[level]);
    setQuote(null);
  }

  const mentionMembers = memberInfo.filter(
    (member) =>
      mentionQuery !== null &&
      member.name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
  );

  function updateMention(value: string, cursor: number) {
    const match = value
      .slice(0, cursor)
      .match(/(?:^|\s|[，。！？：；])@([a-zA-Z]*)$/);
    setMentionQuery(match ? match[1] : null);
    setMentionIndex(0);
  }

  function selectMention(member: (typeof memberInfo)[number]) {
    const textarea = composerRef.current;
    const cursor = textarea?.selectionStart ?? input.length;
    const match = input.slice(0, cursor).match(/@([a-zA-Z]*)$/);
    const start = match ? cursor - match[0].length : cursor;
    const insertion = `@${member.name} `;
    setInput(`${input.slice(0, start)}${insertion}${input.slice(cursor)}`);
    setTarget(member.id);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = start + insertion.length;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || mentionMembers.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex(
        (current) =>
          (current +
            (event.key === "ArrowDown" ? 1 : -1) +
            mentionMembers.length) %
          mentionMembers.length,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectMention(mentionMembers[mentionIndex] || mentionMembers[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMentionQuery(null);
    }
  }

  async function chooseImage(file?: File | null) {
    if (!file || !/^image\/(?:jpeg|png|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/study-group/image", { method: "POST", body: form });
    const result = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !result.url) return;
    setImageDraft({ url: result.url, dataUrl, name: file.name || "貼上的截圖" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!input.trim() && !imageDraft) || busy) return;
    const text = input.trim() || "請閱讀這張圖片，指出與本次主題相關的重點。";
    const sendingImage = imageDraft;
    const student: Message = {
      id: Date.now(),
      speaker: "student",
      text,
      quote: quote
        ? `${labels[quote.speaker]}：${quote.text.slice(0, 90)}`
        : undefined,
      imageUrl: sendingImage?.url,
    };
    const next = [...messages, student];
    setMessages(next);
    setInput("");
    setImageDraft(null);
    setQuote(null);
    setBusy(true);
    const direct = text.match(/@(Luna|DeepSeek|Terra|Sol)/i)?.[1];
    const chosen = direct ? (direct.toLowerCase() as Member) : target;
    setMessages((current) => [
      ...current,
      {
        id: Date.now() + 1,
        speaker: "host",
        text:
          chosen === "host"
            ? "我來判斷最適合的成員先回答；其他人只有在有補充理由時才接話。"
            : chosen === "free"
              ? "開放自由討論，但這一輪最多兩位成員發言。"
              : `先請 ${labels[chosen]} 回答。`,
      },
    ]);
    try {
      const response = await fetch("/api/study-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: quote ? `針對「${quote.text}」：${text}` : text,
          imageDataUrl: sendingImage?.dataUrl,
          target: chosen,
          mood,
          topic,
          messages: next.map((item) => ({
            speaker: labels[item.speaker],
            text: item.text,
          })),
        }),
      });
      const result = (await response.json()) as {
        replies?: Array<{
          speaker: Member;
          text: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          durationMs: number;
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "讀書會暫時無法回應");
      setMessages((current) => [
        ...current,
        ...(result.replies || []).map((item, index) => ({
          id: Date.now() + index + 2,
          ...item,
          text: cleanMarkdown(item.text),
          challengedSpeaker:
            item.speaker === "terra" &&
            quote &&
            ["luna", "deepseek", "sol"].includes(quote.speaker)
              ? (quote.speaker as Member)
              : undefined,
        })),
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 4,
          speaker: "host",
          text: error instanceof Error ? error.message : "讀書會暫時無法回應。",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function startFreeDiscussion() {
    if (busy) return;
    setTarget("free");
    const hostMessage: Message = {
      id: Date.now(),
      speaker: "host",
      text: "現在開放自由討論。請承接剛才的內容主動補充、質疑或點名下一位成員。",
    };
    const next = [...messages, hostMessage];
    setMessages(next);
    setBusy(true);
    try {
      const response = await fetch("/api/study-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "請承接目前最後一則討論，自然地繼續對話；不要重複已經說過的內容。",
          target: "free",
          mood,
          topic,
          messages: next.map((item) => ({
            speaker: labels[item.speaker],
            text: item.text,
          })),
        }),
      });
      const result = (await response.json()) as {
        replies?: Array<{
          speaker: Member;
          text: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          durationMs: number;
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "自由討論暫時無法開始");
      setMessages((current) => [
        ...current,
        ...(result.replies || []).map((item, index) => ({
          id: Date.now() + index + 1,
          ...item,
          text: cleanMarkdown(item.text),
        })),
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 9,
          speaker: "host",
          text: error instanceof Error ? error.message : "自由討論暫時無法開始。",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="study-group-shell">
      <header className="study-group-top">
        <Link href="/" className="study-group-brand">
          <span>律</span>
          <b>司律備考</b>
        </Link>
        <div>
          <span>AI 讀書會</span>
          <Link href="/plan">今日學習目標</Link>
          <Link href="/">回作戰中心</Link>
        </div>
      </header>
      <section className="study-group-heading">
        <div>
          <span>AI STUDY CIRCLE</span>
          <h1>像真的同學一樣，一起把問題聊懂。</h1>
          <p>你可以直接點名、交給主持人派話，或讓其他成員有條件地自然插話。</p>
        </div>
        <aside>
          <small>本次主題</small>
          <b>{topic}</b>
          <button type="button" onClick={() => setIntroOpen(true)}>
            更換主題
          </button>
        </aside>
      </section>

      {introOpen && (
        <section
          className="study-group-intro"
          aria-label="讀書會成員與主題設定"
        >
          <header>
            <div>
              <span>進場前先認識今天的同學</span>
              <h2>四位成員，各有不同程度與任務</h2>
            </div>
            <button type="button" onClick={() => setIntroOpen(false)}>
              收合
            </button>
          </header>
          <div className="study-group-members">
            {memberInfo.map((member) => (
              <article className={member.id} key={member.id}>
                <i>{member.mark}</i>
                <div>
                  <b>{member.name}</b>
                  <span>{member.title}</span>
                  <p>{member.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="study-group-topic">
            <div>
              <small>不知道主題也沒關係</small>
              <b>
                {todayGoal
                  ? `已讀取今日尚未完成目標：${todayGoal.subject}｜${todayGoal.title}`
                  : "今天沒有可用任務，先提供每日推薦主題"}
              </b>
            </div>
            <label>
              自訂主題
              <input
                value={customTopic}
                onChange={(event) => setCustomTopic(event.target.value)}
                placeholder="例如：不作為犯的保證人地位"
              />
            </label>
            <button type="button" onClick={begin}>
              進入讀書會
            </button>
          </div>
          <p className="study-group-disclaimer">
            四位成員都是 AI
            角色，可能犯錯；重要法律結論仍應回到法條、實務與指定教材核對。
          </p>
        </section>
      )}

      <div className="study-group-layout">
        <aside className="study-group-controls">
          <section>
            <span>想問誰？</span>
            {(
              [
                ["host", "主持人決定"],
                ["luna", "Luna 白話"],
                ["deepseek", "DeepSeek 補充"],
                ["terra", "Terra 質疑"],
                ["sol", "Sol 統整"],
                ["free", "自由討論"],
              ] as Array<[Target, string]>
            ).map(([id, label]) => (
              <button
                type="button"
                className={target === id ? "active" : ""}
                onClick={() =>
                  id === "free" ? void startFreeDiscussion() : setTarget(id)
                }
                disabled={id === "free" && busy}
                key={id}
              >
                {id === "free" && busy ? "討論中…" : label}
              </button>
            ))}
          </section>
          <section>
            <span>討論氣氛</span>
            {(
              [
                ["quiet", "安靜"],
                ["natural", "自然"],
                ["lively", "熱烈"],
              ] as Array<[Mood, string]>
            ).map(([id, label]) => (
              <button
                type="button"
                className={mood === id ? "active" : ""}
                onClick={() => setMood(id)}
                key={id}
              >
                {label}
              </button>
            ))}
            <small>
              {mood === "quiet"
                ? "只有被指定者回答"
                : mood === "natural"
                  ? "必要時一位成員補充"
                  : "允許質疑與二輪回應"}
            </small>
          </section>
          <section className="study-group-simulations">
            <span>模擬學生發言</span>
            <button
              type="button"
              className="beginner"
              onClick={() => fillSimulation("beginner")}
            >
              <b>初學小白</b>
              <small>先聽白話與例子</small>
            </button>
            <button
              type="button"
              className="intermediate"
              onClick={() => fillSimulation("intermediate")}
            >
              <b>中階考生</b>
              <small>練要件與判斷界線</small>
            </button>
            <button
              type="button"
              className="advanced"
              onClick={() => fillSimulation("advanced")}
            >
              <b>高階學霸</b>
              <small>進入爭議與攻防</small>
            </button>
            <small>只會帶入發言，確認後再送出</small>
          </section>
          {history.length > 0 && (
            <section className="study-group-history">
              <span>歷次讀書會</span>
              {history.slice(0, 6).map((session) => (
                <button
                  type="button"
                  className={sessionId === session.id ? "active" : ""}
                  onClick={() => openSession(session)}
                  key={session.id}
                >
                  <b>{session.topic}</b>
                  <small>{session.messages.length} 則發言</small>
                </button>
              ))}
            </section>
          )}
          <button
            className="study-group-new"
            type="button"
            onClick={() => {
              sessionIdRef.current = null;
              setSessionId(null);
              setMessages([]);
              setCustomTopic("");
              setIntroOpen(true);
            }}
          >
            ＋ 另開讀書會
          </button>
        </aside>
        <section className="study-group-chat">
          <div className="study-group-messages">
            {messages.length === 0 && (
              <div className="study-group-empty">
                <b>主持人還在等你入席</b>
                <span>確認主題後進入，或直接在下方開始發言。</span>
              </div>
            )}
            {messages.map((message) => (
              <article
                className={`study-group-message ${message.speaker}`}
                key={message.id}
              >
                <div className="study-group-avatar">
                  {message.speaker === "student"
                    ? "我"
                    : message.speaker === "host"
                      ? "持"
                      : memberInfo.find((item) => item.id === message.speaker)
                          ?.mark}
                </div>
                <div>
                  <header>
                    <b>{labels[message.speaker]}</b>
                    {message.model && (
                      <small>
                        {message.model} ·{" "}
                        {(message.inputTokens || 0) +
                          (message.outputTokens || 0)}{" "}
                        tokens · {(message.durationMs || 0).toLocaleString()} ms
                      </small>
                    )}
                  </header>
                  {message.quote && <blockquote>{message.quote}</blockquote>}
                    {message.imageUrl && <img className="study-group-message-image" src={message.imageUrl} alt="讀書會上傳圖片" />}
                    <p>{cleanMarkdown(message.text)}</p>
                  {message.speaker !== "student" &&
                    message.speaker !== "host" && (
                      <footer>
                        <button type="button" onClick={() => setQuote(message)}>
                          引用回覆
                        </button>
                        {message.speaker !== "terra" && (
                          <button
                            type="button"
                            onClick={() => {
                              setTarget("terra");
                              setQuote(message);
                              setInput(
                                `@Terra，請質疑 ${labels[message.speaker]} 這段說法：`,
                              );
                            }}
                          >
                            請 Terra 質疑
                          </button>
                        )}
                        {message.speaker === "terra" &&
                          challengedMember(message) && (
                            <button
                              type="button"
                              onClick={() => {
                                const respondent = challengedMember(message)!;
                                setTarget(respondent);
                                setQuote(message);
                                setInput(
                                  `@${labels[respondent]}，請直接回應 Terra 對你的質疑，說明應保留或修正之處：`,
                                );
                              }}
                            >
                              請 {labels[challengedMember(message)!]} 回應質疑
                            </button>
                          )}
                        {message.speaker !== "deepseek" && (
                          <button
                            type="button"
                            onClick={() => {
                              setTarget("deepseek");
                              setQuote(message);
                              setInput(
                                `@DeepSeek，請補充 ${labels[message.speaker]} 這段說法的法條、學說或不同觀點：`,
                              );
                            }}
                          >
                            請 DeepSeek 補充
                          </button>
                        )}
                        {message.speaker !== "sol" && (
                          <button
                            type="button"
                            onClick={() => {
                              setTarget("sol");
                              setQuote(message);
                              setInput("@Sol，請幫我校準並統整：");
                            }}
                          >
                            請 Sol 統整
                          </button>
                        )}
                      </footer>
                    )}
                </div>
              </article>
            ))}
            {busy && (
              <article className="study-group-message host">
                <div className="study-group-avatar">持</div>
                <div>
                  <p className="study-group-typing">
                    成員正在整理想法<span>•••</span>
                  </p>
                </div>
              </article>
            )}
          </div>
          <form onSubmit={submit}>
            <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { void chooseImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            {quote && (
              <div className="study-group-quote">
                <span>
                  正在回覆 {labels[quote.speaker]}：{quote.text.slice(0, 72)}
                </span>
                <button type="button" onClick={() => setQuote(null)}>
                  ×
                </button>
              </div>
            )}
            {mentionQuery !== null && mentionMembers.length > 0 && (
              <div className="study-group-mention-menu" role="listbox" aria-label="選擇讀書會角色">
                {mentionMembers.map((member, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={index === mentionIndex ? "active" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(member)}
                    key={member.id}
                  >
                    <i className={member.id}>{member.mark}</i>
                    <span><b>{member.name}</b><small>{member.title}</small></span>
                  </button>
                ))}
              </div>
            )}
            {imageDraft && (
              <div className="study-group-image-draft">
                <img src={imageDraft.url} alt="待送出的圖片" />
                <span>{imageDraft.name}</span>
                <button type="button" onClick={() => setImageDraft(null)} aria-label="移除圖片">×</button>
              </div>
            )}
            <button className="study-group-attach" type="button" onClick={() => imageInputRef.current?.click()} aria-label="上傳圖片">＋圖片</button>
            <textarea
              ref={composerRef}
              value={input}
              onChange={(event) => { setInput(event.target.value); updateMention(event.target.value, event.target.selectionStart); }}
              onKeyDown={handleComposerKeyDown}
              onPaste={(event) => {
                const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile();
                if (image) {
                  event.preventDefault();
                  void chooseImage(new File([image], `貼上的截圖-${Date.now()}.png`, { type: image.type }));
                }
              }}
              onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
              placeholder="直接發言，或輸入 @ 點名角色…"
              rows={3}
              aria-autocomplete="list"
              aria-expanded={mentionQuery !== null && mentionMembers.length > 0}
            />
            <div>
              <span>
                目前：
                {target === "host"
                  ? "主持人派話"
                  : target === "free"
                    ? "自由討論"
                    : `指定 ${labels[target]}`}{" "}
                ·{" "}
                {mood === "quiet"
                  ? "安靜模式"
                  : mood === "natural"
                    ? "自然模式"
                    : "熱烈模式"}
              </span>
              <button disabled={busy || (!input.trim() && !imageDraft)}>
                {busy ? "討論中…" : "送出發言"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
