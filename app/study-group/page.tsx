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
type AttachmentTask = "issues" | "summary" | "discuss";
type Message = {
  id: number;
  speaker: "student" | "host" | Member;
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  quote?: string;
  challengedSpeaker?: Member;
  imageUrl?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: "image" | "pdf";
  attachmentTask?: AttachmentTask;
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

function estimatedMessageCost(message: Message) {
  if (typeof message.estimatedCostUsd === "number") return message.estimatedCostUsd;
  const model = (message.model || "").toLowerCase();
  const input = Math.max(0, message.inputTokens || 0);
  const output = Math.max(0, message.outputTokens || 0);
  const rates = model.includes("deepseek")
    ? { input: 0.435, output: 0.87 }
    : model.includes("terra")
      ? { input: 1, output: 6 }
      : model.includes("sol")
        ? { input: 2.5, output: 15 }
        : { input: 0.1, output: 0.6 };
  return (input * rates.input + output * rates.output) / 1_000_000;
}

function formatUsd(value: number) {
  return value < 0.00001 ? value.toFixed(7) : value.toFixed(5);
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
  const [simulationBusy, setSimulationBusy] = useState<StudentLevel | null>(null);
  const [quote, setQuote] = useState<Message | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [history, setHistory] = useState<StudyGroupSession[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [attachmentDraft, setAttachmentDraft] = useState<{ url: string; dataUrl: string; name: string; type: "image" | "pdf" } | null>(null);
  const [attachmentTask, setAttachmentTask] = useState<AttachmentTask>("issues");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
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

  async function fillSimulation(level: StudentLevel) {
    // Prefer the latest actual member statement. Host flow notices are useful
    // context for the model, but they are not what a simulated student should
    // answer in the visible chat.
    const lastMemberMessage = [...messages]
      .reverse()
      .find((message) => ["luna", "deepseek", "terra", "sol"].includes(message.speaker));
    const lastMessage =
      lastMemberMessage ||
      [...messages].reverse().find((message) => message.speaker !== "host");
    // A simulated student must answer or question the latest speaker in their
    // own voice. It must not silently start a multi-agent relay merely because
    // the student level is advanced.
    setTarget(
      lastMessage && ["luna", "deepseek", "terra", "sol"].includes(lastMessage.speaker)
        ? (lastMessage.speaker as Member)
        : "host",
    );
    setMood("quiet");
    setQuote(null);
    if (!lastMessage) {
      setInput("目前還沒有成員發言，請先開始討論。");
      return;
    }
    setSimulationBusy(level);
    setInput("");
    try {
      const response = await fetch("/api/study-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "simulate-student",
          studentLevel: level,
          topic,
          messages: messages.map((item) => ({ speaker: labels[item.speaker], text: item.text })),
        }),
      });
      const result = (await response.json()) as { suggestion?: string; error?: string };
      if (!response.ok || !result.suggestion) throw new Error(result.error || "暫時無法模擬發言");
      setInput(cleanMarkdown(result.suggestion));
    } catch (error) {
      setInput(error instanceof Error ? error.message : "暫時無法模擬發言，請再試一次。");
    } finally {
      setSimulationBusy(null);
    }
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

  async function chooseAttachment(file?: File | null) {
    const isImage = !!file && /^image\/(?:jpeg|png|webp)$/.test(file.type);
    const isPdf = file?.type === "application/pdf";
    if (!file || (!isImage && !isPdf)) return;
    if ((isImage && file.size > 4 * 1024 * 1024) || (isPdf && file.size > 12 * 1024 * 1024)) return;
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
    setAttachmentDraft({ url: result.url, dataUrl, name: file.name || "貼上的截圖", type: isPdf ? "pdf" : "image" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!input.trim() && !attachmentDraft) || busy) return;
    const taskPrompt: Record<AttachmentTask, string> = {
      issues: "請閱讀附件，辨識值得討論的法律爭點，並指出各爭點所在頁面或可辨識位置。",
      summary: "請摘要附件內容，保留重要人物、事實、法律依據與結論，並標示頁面依據。",
      discuss: "請依附件與我的補充問題展開討論；先確認附件內容，再引導我判斷，不要直接跳到結論。",
    };
    const text = input.trim() || (attachmentDraft ? taskPrompt[attachmentTask] : "請開始討論。");
    const sendingAttachment = attachmentDraft;
    const student: Message = {
      id: Date.now(),
      speaker: "student",
      text,
      quote: quote
        ? `${labels[quote.speaker]}：${quote.text.slice(0, 90)}`
        : undefined,
      imageUrl: sendingAttachment?.type === "image" ? sendingAttachment.url : undefined,
      attachmentUrl: sendingAttachment?.url,
      attachmentName: sendingAttachment?.name,
      attachmentType: sendingAttachment?.type,
      attachmentTask: sendingAttachment ? attachmentTask : undefined,
    };
    const next = [...messages, student];
    setMessages(next);
    setInput("");
    setAttachmentDraft(null);
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
          attachmentDataUrl: sendingAttachment?.dataUrl,
          attachmentName: sendingAttachment?.name,
          attachmentType: sendingAttachment?.type,
          attachmentTask: sendingAttachment ? attachmentTask : undefined,
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
          estimatedCostUsd: number;
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
          estimatedCostUsd: number;
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

  async function askMemberToContinue(chosen: Exclude<Target, "free">, sourceMessage?: Message) {
    if (busy) return;
    const latest = sourceMessage || [...messages]
      .reverse()
      .find((message) => message.speaker !== "host");
    if (!latest) {
      setInput("目前還沒有可承接的發言，請先開始討論。");
      return;
    }
    const instructions: Record<Exclude<Target, "free">, string> = {
      host: "請主持人依上一句內容，選擇最適合的成員直接接話。",
      luna: "請用白話承接上一句，先確認對方的重點，再說明或舉例。",
      deepseek: "請精簡承接上一句，只補真正缺少且會影響理解或結論的 1 至 2 個關鍵點，約 150 至 250 字；不要重講完整理論。若這段已完整，請直接說暫無關鍵補充。",
      terra: "請先肯定上一句合理之處，再有禮貌地檢查一個可能遺漏的要件、例外或推論跳躍。",
      sol: "請直接校準並統整上一句，指出應保留、修正與最後如何表述。",
    };
    setTarget(chosen);
    setBusy(true);
    try {
      const response = await fetch("/api/study-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: `${instructions[chosen]}\n要接續的發言由 ${labels[latest.speaker]} 提出：${latest.text}\n請只針對這段接續，不要改答其他訊息。`,
          target: chosen,
          mood: "quiet",
          topic,
          messages: messages.map((item) => ({ speaker: labels[item.speaker], text: item.text })),
        }),
      });
      const result = (await response.json()) as {
        replies?: Array<{ speaker: Member; text: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; durationMs: number }>;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "成員暫時無法接話");
      setMessages((current) => [
        ...current,
        ...(result.replies || []).map((item, index) => ({
          id: Date.now() + index,
          ...item,
          text: cleanMarkdown(item.text),
        })),
      ]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: Date.now(),
        speaker: "host",
        text: error instanceof Error ? error.message : "成員暫時無法接話。",
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="study-group-shell">
      <header className="study-group-top">
        <Link href="/law" className="study-group-brand">
          <span>律</span>
          <b>司律備考</b>
        </Link>
        <div>
          <span>AI 讀書會</span>
          <Link href="/plan">今日學習目標</Link>
          <Link href="/law">回作戰中心</Link>
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
          <div className="study-group-topic-actions">
            {messages.length === 0 && (
              <button className="confirm" type="button" onClick={begin}>
                確認並開始討論
              </button>
            )}
            <button type="button" onClick={() => setIntroOpen(true)}>
              更換主題
            </button>
          </div>
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
                      <small className="study-group-message-usage">
                        <span>{message.model}</span>
                        <span>輸入 {(message.inputTokens || 0).toLocaleString()} · 輸出 {(message.outputTokens || 0).toLocaleString()} · 合計 {((message.inputTokens || 0) + (message.outputTokens || 0)).toLocaleString()} tokens</span>
                        <span>估算 US$ {formatUsd(estimatedMessageCost(message))} · 約 NT$ {(estimatedMessageCost(message) * 32.5).toFixed(4)} · {(message.durationMs || 0).toLocaleString()} ms</span>
                      </small>
                    )}
                  </header>
                  {message.quote && <blockquote>{message.quote}</blockquote>}
                    {message.attachmentType === "pdf" && message.attachmentUrl && (
                      <a className="study-group-message-file" href={message.attachmentUrl} target="_blank" rel="noreferrer">
                        <i>PDF</i><span><b>{message.attachmentName || "讀書會附件.pdf"}</b><small>{message.attachmentTask === "summary" ? "摘要內容" : message.attachmentTask === "discuss" ? "指定內容討論" : "討論法律爭點"}</small></span>
                      </a>
                    )}
                    {(message.imageUrl || (message.attachmentType === "image" && message.attachmentUrl)) && <img className="study-group-message-image" src={message.imageUrl || message.attachmentUrl} alt="讀書會上傳圖片" />}
                    <p>{cleanMarkdown(message.text)}</p>
                  {message.speaker !== "student" &&
                    message.speaker !== "host" && (
                      <footer>
                        <button type="button" onClick={() => setQuote(message)}>
                          引用回覆
                        </button>
                        {message.speaker !== "luna" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void askMemberToContinue("luna", message)}
                          >
                            請 Luna 白話
                          </button>
                        )}
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
                        {message.speaker !== "deepseek" && (<>
                          <button type="button" onClick={() => void askMemberToContinue("deepseek", message)}>
                            DeepSeek 精簡補充
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTarget("deepseek");
                              setQuote(message);
                              setInput(`@DeepSeek，請針對 ${labels[message.speaker]} 這段內容深入補充必要的法條、學說、實務例外或觀點差異：`);
                            }}
                          >
                            DeepSeek 深入補充
                          </button>
                        </>)}
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
            <input ref={attachmentInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" hidden onChange={(event) => { void chooseAttachment(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <div className="study-group-target-picker">
              <div><b>請誰接話？</b><small>點選後，立即針對上一句回應</small></div>
              <div>
                {(
                  [
                    ["host", "主持人決定"],
                    ["luna", "Luna 白話"],
                    ["deepseek", "DeepSeek 精簡補充"],
                    ["terra", "Terra 質疑"],
                    ["sol", "Sol 統整"],
                  ] as Array<[Exclude<Target, "free">, string]>
                ).map(([id, label]) => (
                  <button type="button" className={target === id ? "active" : ""} disabled={busy} onClick={() => void askMemberToContinue(id)} key={id}>{label}</button>
                ))}
                <button type="button" className="free" onClick={() => void startFreeDiscussion()} disabled={busy}>{busy && target === "free" ? "討論中…" : "▶ 直接自由討論"}</button>
              </div>
            </div>
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
            {attachmentDraft && (
              <div className={`study-group-image-draft ${attachmentDraft.type === "pdf" ? "pdf" : ""}`}>
                {attachmentDraft.type === "image" ? <img src={attachmentDraft.url} alt="待送出的圖片" /> : <i>PDF</i>}
                <span><b>{attachmentDraft.name}</b><small>{attachmentDraft.type === "pdf" ? "PDF 上限 12MB" : "圖片／截圖上限 4MB"}</small></span>
                <button type="button" onClick={() => setAttachmentDraft(null)} aria-label="移除附件">×</button>
              </div>
            )}
            {attachmentDraft && (
              <div className="study-group-attachment-task" aria-label="選擇附件討論方式">
                <button type="button" className={attachmentTask === "issues" ? "active" : ""} onClick={() => setAttachmentTask("issues")}>找爭點</button>
                <button type="button" className={attachmentTask === "summary" ? "active" : ""} onClick={() => setAttachmentTask("summary")}>摘要內容</button>
                <button type="button" className={attachmentTask === "discuss" ? "active" : ""} onClick={() => setAttachmentTask("discuss")}>指定內容討論</button>
              </div>
            )}
            <button className="study-group-attach" type="button" onClick={() => attachmentInputRef.current?.click()} aria-label="上傳圖片、截圖或 PDF">＋ 圖片／PDF</button>
            <textarea
              ref={composerRef}
              value={input}
              onChange={(event) => { setInput(event.target.value); updateMention(event.target.value, event.target.selectionStart); }}
              onKeyDown={handleComposerKeyDown}
              onPaste={(event) => {
                const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile();
                if (image) {
                  event.preventDefault();
                  void chooseAttachment(new File([image], `貼上的截圖-${Date.now()}.png`, { type: image.type }));
                }
              }}
              onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
              placeholder="輸入 @ 點名角色；可貼上截圖，或上傳圖片／PDF…"
              rows={3}
              aria-autocomplete="list"
              aria-expanded={mentionQuery !== null && mentionMembers.length > 0}
            />
            <div className="study-group-composer-footer">
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
              <div className="study-group-simulation-shortcuts" aria-label="模擬學生發言">
                <small>模擬同學</small>
                <button type="button" className="beginner" disabled={Boolean(simulationBusy)} onClick={() => fillSimulation("beginner")}>{simulationBusy === "beginner" ? "理解中…" : "初學理解"}</button>
                <button type="button" className="intermediate" disabled={Boolean(simulationBusy)} onClick={() => fillSimulation("intermediate")}>{simulationBusy === "intermediate" ? "整理中…" : "中階推論"}</button>
                <button type="button" className="advanced" disabled={Boolean(simulationBusy)} onClick={() => fillSimulation("advanced")}>{simulationBusy === "advanced" ? "延伸中…" : "高階延伸"}</button>
              </div>
              <button disabled={busy || (!input.trim() && !attachmentDraft)}>
                {busy ? "討論中…" : "送出發言"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
