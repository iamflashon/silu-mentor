"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PengliCover from "../PengliCover";

type CoachMessage = {
  id: string;
  role: "student" | "coach" | "scholar";
  text: string;
  source?: string;
  evidenceMissing?: { question: string; teacherSubmitted?: boolean };
  replyTo?: { id: string; excerpt: string };
  testVerification?: {
    passed: boolean;
    pageMatched: boolean;
    citationMatched: boolean;
    contentMatched: boolean;
    expectedPage: number;
    bookPageLabel: string;
    citedPage: number | null;
    retrievedPages: number[];
    answerAnchor: string;
    questionKind: "case_facts" | "issue_prompt" | "explanation";
    sourceExcerpt: string;
    documentId: number;
    issueTitle: string;
    bodyRole: string;
  };
};
type BookTestMeta = { documentId: number; expectedPage: number; bookPageLabel: string; answerAnchor: string; questionKind: "case_facts" | "issue_prompt" | "explanation"; sourceExcerpt: string; issueTitle: string; bodyRole: string };
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
const topicStorageKey = "pengli-ai-coach-active-topic-v1";

const topicStarters: Record<string, string[]> = {
  "行政法理論基礎與行政組織法": [
    "公法與私法的區分，應依序檢查哪些判準？",
    "法律保留原則在申論題中應如何分層審查？",
    "行政機關與內部單位的權限差異應如何判斷？",
  ],
  行政處分: [
    "一個行政行為是否構成行政處分，應依序判斷哪些要件？",
    "行政處分無效與得撤銷，應如何區分並安排作答？",
    "行政處分附款的合法性，應從哪些層次審查？",
  ],
  行政契約與行政命令: [
    "行政契約與行政處分，應依哪些特徵區分？",
    "法規命令與行政規則的效力有何不同？",
    "行政契約無效時，申論題應如何安排審查順序？",
  ],
  行政罰法: [
    "行政罰的責任要件，應依序審查哪些事項？",
    "一行為不二罰原則，應先確認哪些判斷要素？",
    "行政罰的裁處時效，應如何計算與審查？",
  ],
  行政執行法: [
    "行政執行的義務類型，應如何辨認？",
    "代履行與直接強制，應如何區分？",
    "即時強制的合法性，應依哪些要件判斷？",
  ],
  訴願法與行政訴訟法: [
    "訴願是否合法，應先檢查哪些程序要件？",
    "撤銷訴訟與課予義務訴訟，應如何選擇？",
    "暫時權利保護的必要性，應如何判斷？",
  ],
  國家賠償法與損失補償: [
    "公務員違法行為的國家賠償責任，應如何審查？",
    "公共設施設置或管理欠缺，應如何認定？",
    "損失補償與國家賠償，應如何區分？",
  ],
  新進實務見解整理: [
    "本主題的新進實務見解，改變了哪些既有判斷標準？",
    "引用新進實務見解時，應如何整理爭點與裁判理由？",
    "實務見解與傳統學說不同時，申論題應如何呈現？",
  ],
};

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
  const [bookTestLoading, setBookTestLoading] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [freeTrialAvailable, setFreeTrialAvailable] = useState(false);
  const [freeTrialTopic, setFreeTrialTopic] = useState("");
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const [aiPlanEnabled, setAiPlanEnabled] = useState(false);
  const [scholarAssistEnabled, setScholarAssistEnabled] = useState(true);
  const [bookVerificationVisible, setBookVerificationVisible] = useState(true);
  const [chatMaximized, setChatMaximized] = useState(false);
  const [activeTopic, setActiveTopic] = useState("");
  const [topicLocation, setTopicLocation] = useState<{ pageStart: number; pageEnd?: number | null } | null>(null);
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
      const urlTopic = new URLSearchParams(window.location.search).get("topic")?.trim() || "";
      const savedTopic = localStorage.getItem(topicStorageKey)?.trim() || "";
      const topic = urlTopic || savedTopic;
      if (topic) {
        setActiveTopic(topic);
        localStorage.setItem(topicStorageKey, topic);
        if (urlTopic) setInput(`我正在學「${topic}」，請先用一個問題帶我判斷。`);
        void fetch(`/api/teachers/pengli/coach?topic=${encodeURIComponent(topic)}`, { cache: "no-store" })
          .then(async (response) => response.ok ? response.json() : null)
          .then((data) => {
            if (data?.located && Number.isFinite(data.pageStart)) setTopicLocation({ pageStart: data.pageStart, pageEnd: data.pageEnd });
          })
          .catch(() => undefined);
      }
    } catch {
      /* 使用預設歡迎訊息 */
    }
  }, []);

  useEffect(() => {
    void fetch("/api/ai-access", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.aiAccess) {
          const nextAccess = {
            remaining: data.aiAccess.remaining,
          };
          setAccess(nextAccess);
          if (data?.plan?.enabled === true && nextAccess.remaining === 0 && !data?.pengliTrial?.available) setQuotaDialogOpen(true);
        }
        setFreeTrialAvailable(data?.pengliTrial?.available === true);
        setFreeTrialTopic(String(data?.pengliTrial?.selectedTopic ?? ""));
        if (data?.plan) {
          setAiPlanEnabled(data.plan.enabled === true);
          setScholarAssistEnabled(data.plan.scholarAssistEnabled !== false);
          setBookVerificationVisible(data.plan.pengliBookVerificationEnabled !== false);
        }
      })
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
  const latestPassedBookTest = useMemo(
    () => [...messages].reverse().find((message) => (
      message.role === "coach"
      && message.testVerification?.passed
      && Number(message.testVerification.documentId) > 0
    ))?.testVerification,
    [messages],
  );
  const starters = activeTopic ? topicStarters[activeTopic] ?? [
    `請先整理「${activeTopic}」的核心判斷架構。`,
    `「${activeTopic}」最常見的申論爭點有哪些？`,
    `請從「${activeTopic}」出一題帶我逐步判斷。`,
  ] : [];
  const displayedRemaining = freeTrialAvailable && activeTopic ? 10 : access?.remaining ?? "—";

  function requireAiUse(required = 1) {
    if (freeTrialAvailable && activeTopic) return true;
    if (aiPlanEnabled && access?.remaining != null && access.remaining < required) {
      setQuotaDialogOpen(true);
      setError("");
      return false;
    }
    return true;
  }

  function applyAccess(nextAccess?: Access) {
    if (!nextAccess) return;
    if (freeTrialAvailable && activeTopic) {
      setFreeTrialAvailable(false);
      setFreeTrialTopic(activeTopic);
    }
    setAccess(nextAccess);
    if (nextAccess.remaining === 0) setQuotaDialogOpen(true);
  }

  async function requestCoach(next: CoachMessage[], bookTest?: BookTestMeta) {
    const latestQuestion = next.at(-1)?.text ?? "";
    const refersToPreviousQuestion = /這題|這個問題|上述|上題|剛才|前面|考點破解|怎麼寫|怎麼答|怎麼解/u.test(latestQuestion);
    const continuesBoundaryTest = next.at(-1)?.source === "學霸越界測試（學生角色）"
      || (refersToPreviousQuestion && next.slice(-4, -1).some((message) => message.source === "學霸越界測試（學生角色）"));
    const boundaryQuestion = continuesBoundaryTest
      ? [...next].reverse().find((message) => message.source === "學霸越界測試（學生角色）")?.text
      : undefined;
    const response = await fetch("/api/teachers/pengli/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: next.slice(-12),
        requestKey: crypto.randomUUID(),
        topic: activeTopic || undefined,
        pageHint: bookTest?.expectedPage || undefined,
        testDocumentId: bookTest?.documentId || undefined,
        testAnswerAnchor: bookTest?.answerAnchor || undefined,
        testIssueTitle: bookTest?.issueTitle || undefined,
        testBodyRole: bookTest?.bodyRole || undefined,
        testSourceExcerpt: bookTest?.sourceExcerpt || undefined,
        boundaryTest: continuesBoundaryTest,
        boundaryQuestion,
      }),
    });
    const data = (await response.json()) as {
      reply?: string;
      source?: string;
      error?: string;
      usage?: Usage;
      access?: Access;
      purchaseUrl?: string;
      retrievedPages?: number[];
      sourceMode?: "index" | "private_pdf_page";
      evidenceMissing?: boolean;
      missingQuestion?: string;
      testVerified?: boolean;
    };
    if (!response.ok || !data.reply) {
      if (data.purchaseUrl) {
        setAccess({ remaining: 0 });
        setQuotaDialogOpen(true);
      }
      throw new Error(data.error || "彭狸 AI 教練目前無法回答。");
    }
    const citedPage = Number(data.source?.match(/PDF 第\s*(\d+)/u)?.[1] ?? 0) || null;
    const retrievedPages = (data.retrievedPages ?? []).filter((page) => Number.isFinite(page));
    const contentMatched = bookTest ? data.testVerified !== false && data.reply.normalize("NFKC").replace(/\s+/gu, "").includes(bookTest.answerAnchor.normalize("NFKC").replace(/\s+/gu, "")) : false;
    const pageMatched = bookTest ? retrievedPages[0] === bookTest.expectedPage : false;
    const citationMatched = bookTest ? citedPage === bookTest.expectedPage : false;
    const testVerification = bookTest ? {
      passed: pageMatched && citationMatched && contentMatched,
      pageMatched,
      citationMatched,
      contentMatched,
      expectedPage: bookTest.expectedPage,
      bookPageLabel: bookTest.bookPageLabel,
      citedPage,
      retrievedPages,
      answerAnchor: bookTest.answerAnchor,
      questionKind: bookTest.questionKind,
      sourceExcerpt: bookTest.sourceExcerpt,
      documentId: bookTest.documentId,
      issueTitle: bookTest.issueTitle,
      bodyRole: bookTest.bodyRole,
    } : undefined;
    const displayedReply = testVerification && !testVerification.passed
      ? "本頁文字目前無法完成核對，系統已停止回答；本次不扣使用次數。"
      : data.reply!;
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "coach",
        text: displayedReply,
        source: data.source,
        evidenceMissing: data.evidenceMissing ? { question: data.missingQuestion || next.at(-1)?.text || "" } : undefined,
        testVerification,
      },
    ]);
    setUsage(data.usage || null);
    applyAccess(data.access);
  }

  async function ask(text: string, bookTest?: BookTestMeta, role: "student" | "scholar" = "student", source?: string) {
    const question = text.trim();
    if (!question || thinking || scholarThinking) return;
    if (!requireAiUse()) return;
    const quoted = replyTarget
      ? `針對這段回覆：「${replyTarget.text.slice(0, 240)}」\n\n${question}`
      : question;
    const studentMessage = {
      id: crypto.randomUUID(),
      role,
      text: question,
      source,
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
      await requestCoach(requestNext, bookTest);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "彭狸 AI 教練目前無法回答。",
      );
    } finally {
      setThinking(false);
    }
  }

  async function runBookContentTest() {
    if (thinking || scholarThinking || bookTestLoading) return;
    if (!requireAiUse()) return;
    setBookTestLoading(true);
    setError("");
    try {
      const testedPages = messages.flatMap((message) => message.testVerification?.expectedPage ? [message.testVerification.expectedPage] : []).slice(-24);
      const testedQuestions = messages.filter((message) => message.role === "student" && /^書內第\s*[1-8]-\d+\s*頁/u.test(message.text)).map((message) => message.text).slice(-24);
      const response = await fetch("/api/teachers/pengli/random-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: activeTopic || undefined, excludedPages: testedPages, excludedQuestions: testedQuestions }) });
      const data = await response.json() as { question?: string; questionKind?: "case_facts" | "issue_prompt" | "explanation"; documentId?: number; expectedPage?: number; bookPageLabel?: string; answerAnchor?: string; sourceExcerpt?: string; issueTitle?: string; bodyRole?: string; error?: string };
      if (!response.ok || !data.question || !data.questionKind || !data.documentId || !data.expectedPage || !data.bookPageLabel || !data.answerAnchor) throw new Error(data.error || "無法產生書頁驗證題目。");
      await ask(data.question, { documentId: data.documentId, expectedPage: data.expectedPage, bookPageLabel: data.bookPageLabel, answerAnchor: data.answerAnchor, questionKind: data.questionKind, sourceExcerpt: data.sourceExcerpt ?? "", issueTitle: data.issueTitle ?? "", bodyRole: data.bodyRole ?? "考點正文" }, "scholar", "學霸照教材提問（學生角色）");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法產生書頁驗證題目。");
    } finally {
      setBookTestLoading(false);
    }
  }

  async function runBoundaryTest() {
    const questions = [
      "請說明《出師表》的主旨與作者情感。",
      "請幫我作一筆機器設備折舊的會計分錄。",
      "血液檢驗中的白血球分類應如何判讀？",
      "刑法共同正犯的犯意聯絡要如何認定？",
      "行政程序法第999條是否規定元宇宙行政處分的效力？",
      "行政機關用區塊鏈發出虛擬許可證，是否必然屬於本書所稱的行政處分？",
    ];
    const question = questions[Math.floor(Math.random() * questions.length)];
    await ask(question, undefined, "scholar", "學霸越界測試（學生角色）");
  }

  async function askScholarFollowUp() {
    if (thinking || scholarThinking) return;
    if (!requireAiUse()) return;
    const target = latestPassedBookTest;
    if (!target) {
      setError("請先按「學霸照書問」，完成一次書頁核對後才能繼續追問。");
      return;
    }
    const bookTest: BookTestMeta = {
      documentId: target.documentId,
      expectedPage: target.expectedPage,
      bookPageLabel: target.bookPageLabel,
      answerAnchor: target.answerAnchor,
      questionKind: target.questionKind,
      sourceExcerpt: target.sourceExcerpt,
      issueTitle: target.issueTitle,
      bodyRole: target.bodyRole,
    };
    setScholarThinking(true);
    setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "scholar-follow-up",
          messages: messages.slice(-12),
          topic: activeTopic || undefined,
          pageHint: bookTest.expectedPage,
          testAnswerAnchor: bookTest.answerAnchor,
          testIssueTitle: bookTest.issueTitle,
          testBodyRole: bookTest.bodyRole,
          testSourceExcerpt: bookTest.sourceExcerpt,
        }),
      });
      const data = (await response.json()) as {
        scholarFollowUp?: string;
        error?: string;
        purchaseUrl?: string;
      };
      if (!response.ok || !data.scholarFollowUp) {
        if (data.purchaseUrl) {
          setAccess({ remaining: 0 });
          setQuotaDialogOpen(true);
        }
        throw new Error(data.error || "學霸目前無法繼續追問。");
      }
      const next = [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "scholar" as const,
          text: data.scholarFollowUp,
          source: "學霸繼續追問（學生角色）",
        },
      ];
      setMessages(next);
      setReplyTarget(null);
      setScholarThinking(false);
      setThinking(true);
      await requestCoach(next, bookTest);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "學霸目前無法繼續追問。",
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
          mode: doubtTarget.evidenceMissing ? "official-answer" : "verify-doubt",
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
      applyAccess(data.access);
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

  async function sendMissingQuestionToTeacher(message: CoachMessage) {
    if (!message.evidenceMissing || message.evidenceMissing.teacherSubmitted) return;
    setError("");
    try {
      const response = await fetch("/api/teachers/pengli/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageKey: message.id,
          conversationKey: storageKey,
          topic: activeTopic || "行政法",
          studentQuestion: message.evidenceMissing.question,
          aiReply: message.text,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "目前無法轉請老師回答。");
      setMessages((current) => current.map((item) => item.id === message.id && item.evidenceMissing
        ? { ...item, evidenceMissing: { ...item.evidenceMissing, teacherSubmitted: true } }
        : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "目前無法轉請老師回答。");
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
          {activeTopic ? <span className="active-topic">目前主題：{activeTopic}</span> : <a className="topic-required" href="/teachers/pengli#curriculum">尚未選擇主題，請先從八大主題進入</a>}
          {activeTopic && <span className="topic-page">{topicLocation ? `PDF 第 ${topicLocation.pageStart}${topicLocation.pageEnd && topicLocation.pageEnd !== topicLocation.pageStart ? `–${topicLocation.pageEnd}` : ""} 頁` : "正在定位教材頁碼…"}</span>}
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
          <strong>{displayedRemaining} 次</strong>
          {freeTrialTopic && <small>免費主題：{freeTrialTopic}</small>}
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
              {activeTopic ? starters.map((starter) => (
                <button
                  type="button"
                  key={starter}
                  onClick={() => void ask(starter)}
                >
                  {starter}
                  <b>→</b>
                </button>
              )) : (
                <a className="choose-topic" href="/teachers/pengli#curriculum">
                  <span>請先選擇一個主題，我會依該主題提供三個練習問題。</span>
                  <b>選擇八大主題 →</b>
                </a>
              )}
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
                      ? message.source?.startsWith("學霸繼續追問")
                        ? "我的回答與追問（學霸）"
                        : message.source?.startsWith("學霸越界")
                          ? "我的問題（學霸越界測試）"
                          : "我的問題（學霸照書問）"
                      : "我的問題"}
                </small>
                <p>{message.text}</p>
                {message.source && <span>（根據《{message.source}）</span>}
                {bookVerificationVisible && message.testVerification && (
                  <details className={`pengli-book-test-result ${message.testVerification.passed ? "pass" : "fail"}`}>
                    <summary>
                      <strong>{message.testVerification.passed ? "✓ 書頁內容核對通過" : "⚠ 書頁內容驗證未完全通過"}</strong>
                      <small>點擊查看核對內容</small>
                    </summary>
                    <div className="pengli-book-test-result-body">
                      <span>抽問頁碼：{message.testVerification.bookPageLabel ? `書內第 ${message.testVerification.bookPageLabel} 頁 ↔ ` : ""}PDF 第 {message.testVerification.expectedPage} 頁</span>
                      <span>{message.testVerification.pageMatched ? "✓" : "✕"} 搜尋頁面：原始 PDF 第 {message.testVerification.expectedPage} 頁 → {message.testVerification.retrievedPages[0] ? `命中第 ${message.testVerification.retrievedPages[0]} 頁` : "未命中"}</span>
                      <span>{message.testVerification.citationMatched ? "✓" : "✕"} 系統引用：{message.testVerification.citedPage ? `PDF 第 ${message.testVerification.citedPage} 頁` : "未標示"}</span>
                      <span>{message.testVerification.contentMatched ? "✓" : "✕"} 回答內容：{message.testVerification.contentMatched ? "包含本頁可核對答案" : "未包含本頁可核對答案"}</span>
                      <span>其他候選頁：{message.testVerification.retrievedPages.slice(1).length ? message.testVerification.retrievedPages.slice(1).map((page) => `第 ${page} 頁`).join("、") : "無"}</span>
                      <small>題型：{message.testVerification.questionKind === "explanation" ? "解題說明" : message.testVerification.questionKind === "issue_prompt" ? "待分析爭點" : "案例事實"}</small>
                      <small>核對答案原文：{message.testVerification.answerAnchor}</small>
                      <details><summary>查看抽樣頁原文</summary><p>{message.testVerification.sourceExcerpt}</p></details>
                    </div>
                  </details>
                )}
                {message.role === "coach" && message.evidenceMissing && (
                  <nav className="pengli-missing-actions">
                    <button type="button" disabled={message.evidenceMissing.teacherSubmitted} onClick={() => {
                      setDoubtTarget(message);
                      setDoubtText(message.evidenceMissing?.question || "");
                      setVerification(null);
                    }}>查證官方資料</button>
                    <button type="button" disabled={message.evidenceMissing.teacherSubmitted} onClick={() => void sendMissingQuestionToTeacher(message)}>
                      {message.evidenceMissing.teacherSubmitted ? "已轉請老師回答" : "轉請老師回答"}
                    </button>
                  </nav>
                )}
                {message.role === "coach" && !message.evidenceMissing && (
                  <nav className="pengli-message-actions">
                    <button
                      type="button"
                      className="pengli-inline-followup"
                      onClick={() => {
                        setReplyTarget(message);
                        setDoubtTarget(null);
                      }}
                    >
                      ↩ 針對這段追問
                    </button>
                    {!message.testVerification?.passed && (
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
                    )}
                  </nav>
                )}
              </div>
            </article>
          ))}
          {scholarThinking && (
            <article className="student thinking">
              <div className="pengli-coach-avatar">我</div>
              <div>
                <small>我的回答與追問（學霸）</small>
                <p>正在先回答老師，再沿著同一書頁準備下一個問題……</p>
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
            <b>{doubtTarget.evidenceMissing ? "未找到對應書頁：查證官方資料" : "針對這則 AI 回覆提出疑問"}</b>
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
                <p className="pengli-verification-status">目前剩餘 {displayedRemaining} 次；只有成功產生可驗證的官方來源與網址才扣 2 次，查詢失敗不扣。</p>
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
                <button
                  type="button"
                  className="pengli-verification-close"
                  onClick={() => {
                    setDoubtTarget(null);
                    setVerification(null);
                    setDoubtError("");
                  }}
                >
                  關閉查證結果
                </button>
              </div>
            )}
          </section>
        )}
        <div className="pengli-coach-usage-bar" aria-label="AI 使用狀態">
          <span>
            AI 使用次數剩餘 <strong>{displayedRemaining} 次</strong>
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
          <div className="pengli-coach-test-tools">
            <button
              type="button"
              className="pengli-book-test-button"
              title="由學霸抽取目前主題的教材頁面提問"
              onClick={() => void runBookContentTest()}
              disabled={thinking || scholarThinking || bookTestLoading}
            >
              <b>書</b>
              <span>{bookTestLoading ? "抽頁中…" : "學霸照書問"}</span>
            </button>
            <button
              type="button"
              className="pengli-boundary-test-button"
              title="隨機提出非本科或教材未收錄的混淆問題，測試拒答與查證流程"
              onClick={() => void runBoundaryTest()}
              disabled={thinking || scholarThinking || bookTestLoading}
            >
              <b>界</b>
              <span>學霸越界問</span>
            </button>
            <button
              type="button"
              className="pengli-follow-up-test-button"
              title={latestPassedBookTest ? "沿用剛才核對成功的同一書頁與考點繼續追問" : "請先完成一次學霸照書問"}
              onClick={() => void askScholarFollowUp()}
              disabled={thinking || scholarThinking || bookTestLoading || !latestPassedBookTest}
            >
              <b>續</b>
              <span>{scholarThinking ? "回答並追問中…" : "學霸回答再問"}</span>
            </button>
          </div>
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
          <a className="pengli-mobile-access" href="/teachers/pengli/ai-access">
            購買／兌換碼
          </a>
          <small>AI 使用次數剩餘 {displayedRemaining} 次</small>
        </footer>
      </div>
      {quotaDialogOpen && (
        <div className="pengli-quota-overlay" role="presentation">
          <section className="pengli-quota-dialog" role="dialog" aria-modal="true" aria-labelledby="pengli-quota-title">
            <b className="pengli-quota-zero" aria-hidden="true">0</b>
            <span>AI 使用次數已用完</span>
            <h2 id="pengli-quota-title">需要補充次數才能繼續提問</h2>
            <p>目前不會再送出問題，也不會產生額外扣次。購買次數或輸入兌換碼後，就能接著目前的對話繼續學習。</p>
            <div>
              <a href="/teachers/pengli/ai-access">購買／輸入兌換碼</a>
              <button type="button" onClick={() => setQuotaDialogOpen(false)}>稍後再說</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
