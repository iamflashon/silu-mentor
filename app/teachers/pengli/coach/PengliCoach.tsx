"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PengliCover from "../PengliCover";

type CoachMessage = {
  id: string;
  role: "student" | "coach" | "scholar";
  text: string;
  source?: string;
  replyTo?: { id: string; excerpt: string };
};
type Usage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
type Access = {
  charged?: boolean;
  remaining?: number | null;
};
const storageKey = "pengli-ai-coach-history-v1";

const starters = [
  "本題為什麼要先判斷請求權基礎？",
  "法律保留原則的作答架構怎麼寫？",
  "幫我練習判斷行政處分的外部性。",
];

export default function PengliCoach() {
  const [messages, setMessages] = useState<CoachMessage[]>([
    {
      id: "welcome",
      role: "coach",
      text: "我是彭狸 AI 教練。這裡只依彭狸老師《行政法考點（考前衝刺）演習書》的學習脈絡陪你練習；我會先幫你找爭點與破題方向，不會一開始就把整份擬答貼給你。",
      source: "專區使用說明",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [scholarThinking, setScholarThinking] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [scholarAssistEnabled, setScholarAssistEnabled] = useState(true);
  const [chatMaximized, setChatMaximized] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CoachMessage | null>(null);
  const [doubtTarget, setDoubtTarget] = useState<CoachMessage | null>(null);
  const [doubtText, setDoubtText] = useState("");
  const [doubtLoading, setDoubtLoading] = useState(false);
  const [verificationStage, setVerificationStage] = useState(0);
  const [doubtError, setDoubtError] = useState("");
  const [verification, setVerification] = useState<{
    ticketId: number;
    text: string;
    sources: { label: string; url?: string }[];
    searchTrace?: { mode: "official_web" | "synchronized_official_data"; terms: string[]; platformLookupFailed?: boolean; checkedAgencies: string[] };
    escalated?: boolean;
  } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as
        CoachMessage[] | null;
      if (Array.isArray(saved) && saved.length)
        setMessages(
          saved
            .slice(-40)
            .map((message) => ({
              ...message,
              id: message.id || crypto.randomUUID(),
            })),
        );
      const topic = new URLSearchParams(window.location.search).get("topic");
      if (topic) setInput(`我正在學「${topic}」，請先用一個問題帶我判斷。`);
    } catch {
      /* 使用預設歡迎訊息 */
    }
  }, []);

  useEffect(() => {
    void fetch("/api/ai-access", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.aiAccess)
          setAccess({
            remaining: data.aiAccess.remaining,
          });
        if (data?.plan)
          setScholarAssistEnabled(data.plan.scholarAssistEnabled !== false);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void fetch("/api/teachers/pengli/questions", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => setUnreadCount(Number(data?.unreadCount || 0)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const hasConversation = useMemo(
    () => messages.some((message) => message.role === "student"),
    [messages],
  );

  async function requestCoach(next: CoachMessage[]) {
    const response = await fetch("/api/teachers/pengli/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: next.slice(-12),
        requestKey: crypto.randomUUID(),
      }),
    });
    const data = (await response.json()) as {
      reply?: string;
      source?: string;
      error?: string;
      usage?: Usage;
      access?: Access;
      purchaseUrl?: string;
    };
    if (!response.ok || !data.reply) {
      if (data.purchaseUrl) window.location.href = "/teachers/pengli/ai-access";
      throw new Error(data.error || "彭狸 AI 教練目前無法回答。");
    }
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "coach",
        text: data.reply!,
        source: data.source,
      },
    ]);
    setUsage(data.usage || null);
    if (data.access) setAccess(data.access);
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!question || thinking || scholarThinking) return;
    const quoted = replyTarget
      ? `針對這段回覆：「${replyTarget.text.slice(0, 240)}」\n\n${question}`
      : question;
    const studentMessage = {
      id: crypto.randomUUID(),
      role: "student" as const,
      text: question,
      replyTo: replyTarget
        ? { id: replyTarget.id, excerpt: replyTarget.text.slice(0, 120) }
        : undefined,
    };
    const next = [...messages, studentMessage];
    const requestNext = [...messages, { ...studentMessage, text: quoted }];
    setMessages(next);
    setInput("");
    setReplyTarget(null);
    setThinking(true);
    setError("");
    try {
      await requestCoach(requestNext);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "彭狸 AI 教練目前無法回答。",
      );
    } finally {
      setThinking(false);
    }
  }

  async function askScholarToAnswer() {
    if (thinking || scholarThinking) return;
    const latestCoach = [...messages]
      .reverse()
      .find((message) => message.role === "coach");
    const targetCoach = replyTarget?.role === "coach" ? replyTarget : latestCoach;
    if (!targetCoach) return;
    const contextMessages = replyTarget
      ? [
          ...messages.filter((message) => message.id !== targetCoach.id).slice(-10),
          targetCoach,
        ]
      : messages.slice(-12);
    setScholarThinking(true);
    setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "scholar-assist",
          messages: contextMessages,
        }),
      });
      const data = (await response.json()) as {
        scholarDraft?: string;
        error?: string;
        purchaseUrl?: string;
      };
      if (!response.ok || !data.scholarDraft) {
        if (data.purchaseUrl)
          window.location.href = "/teachers/pengli/ai-access";
        throw new Error(data.error || "AI 學霸目前無法代答。");
      }
      const next = [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "scholar" as const,
          text: data.scholarDraft,
          source: "學霸代答（學生角色）",
        },
      ];
      setMessages(next);
      setReplyTarget(null);
      setScholarThinking(false);
      setThinking(true);
      await requestCoach(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "AI 學霸目前無法代答。",
      );
    } finally {
      setScholarThinking(false);
      setThinking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  async function verifyDoubt() {
    if (!doubtTarget || !doubtText.trim() || doubtLoading) return;
    setDoubtLoading(true);
    setVerificationStage(1);
    setDoubtError("");
    setVerification(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 32_000);
    const stageTimers = [
      window.setTimeout(() => setVerificationStage(2), 700),
      window.setTimeout(() => setVerificationStage(3), 1800),
    ];
    try {
      const response = await fetch("/api/teachers/pengli/coach", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "verify-doubt",
          messageKey: doubtTarget.id,
          aiReply: doubtTarget.text,
          studentQuestion: doubtText,
          topic:
            new URLSearchParams(window.location.search).get("topic") ||
            "行政法",
          conversationKey: storageKey,
          requestKey: crypto.randomUUID(),
        }),
      });
      const data = (await response.json()) as {
        verification?: string;
        ticketId?: number;
        sources?: { label: string; url?: string }[];
        access?: Access;
        searchTrace?: { mode: "official_web" | "synchronized_official_data"; terms: string[]; platformLookupFailed?: boolean; checkedAgencies: string[] };
        error?: string;
      };
      if (!response.ok || !data.verification || !data.ticketId)
        throw new Error(data.error || "目前無法完成查證。");
      setVerification({
        ticketId: data.ticketId,
        text: data.verification,
        sources: data.sources || [],
        searchTrace: data.searchTrace,
      });
      if (data.access) setAccess(data.access);
    } catch (cause) {
      setDoubtError(cause instanceof DOMException && cause.name === "AbortError"
        ? "官方資料查證逾時，此次沒有計入使用次數。請縮短疑問後再試一次。"
        : cause instanceof TypeError
          ? "目前無法連接查證服務，此次沒有計入使用次數。請稍後再試。"
          : cause instanceof Error ? cause.message : "目前無法完成查證，請稍後再試。");
    } finally {
      window.clearTimeout(timeout);
      stageTimers.forEach((timer) => window.clearTimeout(timer));
      setVerificationStage(0);
      setDoubtLoading(false);
    }
  }

  async function escalateDoubt() {
    if (!verification) return;
    setDoubtError("");
    try {
      const response = await fetch("/api/teachers/pengli/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: verification.ticketId, action: "escalate" }),
      });
      if (!response.ok) throw new Error("目前無法送交確認，請稍後再試。");
      setVerification({ ...verification, escalated: true });
    } catch (cause) {
      setDoubtError(cause instanceof Error ? cause.message : "目前無法送交確認，請稍後再試。");
    }
  }

  return (
    <section
      className={`pengli-coach-shell${chatMaximized ? " chat-maximized" : ""}`}
    >
      <aside className="pengli-coach-sidebar">
        <div className="pengli-coach-identity">
          <PengliCover />
          <div>
            <small>彭狸老師專屬</small>
            <strong>行政法 AI 教練</strong>
            <span>教材優先・引導作答</span>
          </div>
        </div>
        <div className="pengli-coach-scope">
          <b>目前教材範圍</b>
          <span>行政法 8 大主題</span>
          <span>試學考點與解題脈絡</span>
          <span>老師提醒與作答架構</span>
        </div>
        <div className="pengli-coach-rule">
          <b>回答原則</b>
          <p>
            不混用其他老師教材。超出彭狸教材索引時，會明確標示「AI
            補充」，不冒充老師原文。
          </p>
        </div>
        <div className="pengli-coach-access">
          <b>AI 使用次數</b>
          <strong>{access?.remaining ?? "—"} 次</strong>
          <span>一般回答 1 次・官方查證 2 次</span>
          <a href="/teachers/pengli/ai-access">購買／輸入兌換碼</a>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessages([
              {
                id: crypto.randomUUID(),
                role: "coach",
                text: "新的練習開始了。請貼上行政法題目，或告訴我你正在讀哪一個考點。",
                source: "彭狸 AI 教練",
              },
            ]);
            setUsage(null);
            setError("");
          }}
        >
          ＋ 另開練習
        </button>
      </aside>

      <div className="pengli-coach-main">
        <button
          type="button"
          className="pengli-chat-maximize"
          aria-pressed={chatMaximized}
          onClick={() => setChatMaximized((value) => !value)}
        >
          {chatMaximized ? "退出最大化" : "⛶ 最大化對話"}
        </button>
        <header>
          <div>
            <span>彭狸 AI 教練</span>
            <h1>先找爭點，再把答案寫出來</h1>
          </div>
          <i>
            <b /> 教材模式
          </i>
        </header>
        <div className="pengli-coach-thread" aria-live="polite">
          {!hasConversation && (
            <div className="pengli-coach-starters">
              {starters.map((starter) => (
                <button
                  type="button"
                  key={starter}
                  onClick={() => void ask(starter)}
                >
                  {starter}
                  <b>→</b>
                </button>
              ))}
            </div>
          )}
          {messages.map((message) => (
            <article
              data-selection-scope="pengli"
              data-selection-source={message.source || ""}
              className={message.role === "coach" ? "coach" : "student"}
              key={message.id}
            >
              <div className="pengli-coach-avatar">
                {message.role === "coach" ? "狸" : "我"}
              </div>
              <div>
                {message.replyTo && (
                  <blockquote>回覆：{message.replyTo.excerpt}…</blockquote>
                )}
                <small>
                  {message.role === "coach"
                    ? "彭狸 AI 教練"
                    : message.role === "scholar"
                      ? "我的回答（學霸幫我答）"
                      : "我的問題"}
                </small>
                <p>{message.text}</p>
                {message.source && <span>（根據《{message.source}）</span>}
                {message.role === "coach" && (
                  <nav className="pengli-message-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTarget(message);
                        setDoubtTarget(null);
                      }}
                    >
                      ↩ 針對這段追問
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDoubtTarget(message);
                        setDoubtText("");
                        setVerification(null);
                      }}
                    >
                      ？ 我有疑問
                    </button>
                  </nav>
                )}
              </div>
            </article>
          ))}
          {scholarThinking && (
            <article className="student thinking">
              <div className="pengli-coach-avatar">我</div>
              <div>
                <small>我的回答（學霸幫我答）</small>
                <p>正在替我整理回答與要問老師的問題……</p>
              </div>
            </article>
          )}
          {thinking && (
            <article className="coach thinking">
              <div className="pengli-coach-avatar">狸</div>
              <div>
                <small>彭狸 AI 教練</small>
                <p>正在回應學員的回答與追問……</p>
              </div>
            </article>
          )}
          <div ref={endRef} />
        </div>
        {error && <p className="pengli-coach-error">{error}</p>}
        {doubtTarget && (
          <section className="pengli-doubt-panel">
            <button
              type="button"
              className="close"
              onClick={() => {
                setDoubtTarget(null);
                setVerification(null);
                setDoubtError("");
              }}
            >
              ×
            </button>
            <b>針對這則 AI 回覆提出疑問</b>
            <blockquote>
              {doubtTarget.text.slice(0, 300)}
              {doubtTarget.text.length > 300 ? "…" : ""}
            </blockquote>
            {!verification ? (
              <>
                <textarea
                  value={doubtText}
                  onChange={(event) => setDoubtText(event.target.value)}
                  placeholder="寫下你認為不正確、不完整，或想確認的地方……"
                />
                <button
                  type="button"
                  onClick={() => void verifyDoubt()}
                  disabled={!doubtText.trim() || doubtLoading || (access?.remaining != null && access.remaining < 2)}
                >
                  {doubtLoading
                    ? "正在查證官方法規與裁判…"
                    : "使用 2 次查證官方資料"}
                </button>
                {doubtLoading && <div className="pengli-verification-progress" role="status"><strong>{verificationStage <= 1 ? "正在整理查詢關鍵字…" : verificationStage === 2 ? "正在比對已同步的法規與裁判…" : "正在搜尋司法院、憲法法庭與全國法規資料庫…"}</strong><ol><li className={verificationStage >= 1 ? "active" : ""}>整理疑問</li><li className={verificationStage >= 2 ? "active" : ""}>比對平台資料</li><li className={verificationStage >= 3 ? "active" : ""}>查詢官方網站</li></ol></div>}
                <p className="pengli-verification-status">目前剩餘 {access?.remaining ?? "—"} 次；只有成功產生可驗證的官方來源與網址才扣 2 次，查詢失敗不扣。</p>
                {access?.remaining != null && access.remaining < 2 && <a href="/teachers/pengli/ai-access">AI 使用次數不足，前往購買／兌換</a>}
                {doubtError && <p className="pengli-doubt-error" role="alert">{doubtError}</p>}
              </>
            ) : (
              <div className="pengli-verification">
                <h3>AI 外部查證結果</h3>
                {verification.searchTrace && <div className="pengli-verification-trace"><b>{verification.searchTrace.mode === "official_web" ? "已查詢官方網站" : "已比對平台同步官方資料"}</b><span>查詢詞：{verification.searchTrace.terms.length ? verification.searchTrace.terms.join("、") : "依完整疑問搜尋"}</span><small>範圍：{verification.searchTrace.checkedAgencies.join("、")}</small></div>}
                <p>{verification.text}</p>
                {verification.sources.length > 0 && (
                  <><h4>官方來源（點擊開啟原文）</h4><ul>
                    {verification.sources.map((source) => (
                      <li key={source.label}>
                        {source.url ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.label}
                          </a>
                        ) : (
                          source.label
                        )}
                      </li>
                    ))}
                  </ul></>
                )}
                {verification.escalated ? (
                  <strong>
                    已送交管理員確認；確認後會轉交彭狸老師，回覆會在「我的筆記」通知你。
                  </strong>
                ) : (
                  <button type="button" onClick={() => void escalateDoubt()}>
                    仍有疑問，申請轉請彭狸老師
                  </button>
                )}
                {doubtError && <p className="pengli-doubt-error" role="alert">{doubtError}</p>}
              </div>
            )}
          </section>
        )}
        <div className="pengli-coach-usage-bar" aria-label="AI 使用狀態">
          <span>
            AI 使用次數剩餘 <strong>{access?.remaining ?? "—"} 次</strong>
          </span>
          <span>一般回答扣 1 次・官方查證成功扣 2 次</span>
          <a href="/teachers/pengli/ai-access">購買／兌換</a>
        </div>
        <form className="pengli-coach-composer" onSubmit={submit}>
          {replyTarget && (
            <div className="pengli-reply-target">
              <span>正在回覆：{replyTarget.text.slice(0, 100)}…</span>
              <button type="button" onClick={() => setReplyTarget(null)}>
                ×
              </button>
            </div>
          )}
          {scholarAssistEnabled && (
            <button
              type="button"
              className="pengli-scholar-button"
              title="示範判斷、說明思路並反問老師"
              onClick={() => void askScholarToAnswer()}
              disabled={
                thinking ||
                scholarThinking ||
                !messages.some((message) => message.role === "coach")
              }
            >
              <b>霸</b>
              <span>學霸怎麼想？</span>
            </button>
          )}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={2}
            placeholder="貼上行政法題目，或告訴我你卡在哪個爭點……"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking || scholarThinking}
          >
            送出
          </button>
        </form>
        <footer>
          <span>AI 分身不等同真人老師；成功回答扣 1 次，官方查證成功扣 2 次。</span>
          <a className="pengli-notes-link" href="/teachers/pengli/notes">
            ✉ 我的筆記{unreadCount > 0 ? `（${unreadCount} 封新回覆）` : ""}
          </a>
          <a className="pengli-mobile-access" href="/teachers/pengli/ai-access">
            購買／兌換碼
          </a>
          <small>AI 使用次數剩餘 {access?.remaining ?? "—"} 次</small>
        </footer>
      </div>
    </section>
  );
}
