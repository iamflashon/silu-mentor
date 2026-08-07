"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EssayHistory } from "./essay-history";

type PracticeQuestion = {
  id: number;
  examType: "mcq" | "essay";
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string> | null;
  hasTeacherAnswer?: boolean;
  answerSource?: string;
  answerStatus?: string;
};

type EssayGrading = {
  score: number;
  overall: string;
  solution_steps?: Array<{
    step: number;
    title: string;
    focus: string;
    analysis: string;
    student_performance: string;
    next_action: string;
  }>;
  dimensions: Array<{
    criterion: string;
    score: number;
    max_score: number;
    result: string;
    evidence: string;
    missing: string;
  }>;
  strengths: string[];
  priority_fixes: string[];
  next_step: string;
  source_used: string;
};

type EssayModelMode = "sol" | "claude" | "dual";
type EssayComparison = {
  scoreDifference: number;
  agreements: string[];
  differences: Array<{ criterion: string; sol: number; claude: number }>;
};
type EssayModelFailure = {
  model: "sol" | "claude";
  label: string;
  message: string;
  retryable: boolean;
};

type CoachMessage = { role: "mentor" | "student" | "scholar"; text: string };
type CoachTeachingLevel = "general" | "beginner" | "intermediate" | "advanced" | "super";
type CoachModelMode = "luna" | "sonnet" | "deepseek" | "compare-luna-sonnet" | "compare-luna-deepseek" | "compare-sonnet-deepseek" | "compare-luna-sonnet-deepseek";
type CoachComparison = { label: string; model: string; text: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
type CoachProgress = {
  stage: number;
  current: string;
  items: Array<{ label: string; status: "done" | "current" | "pending" }>;
  readyForEssay: boolean;
};
type CoachRecommendation = {
  type: string;
  title: string;
  location: string;
  url: string;
  startSeconds: number | null;
};

type Props = { initialType: "mcq" | "essay" };
type PracticeMode = "today" | "custom" | "laws";
type PracticeFacets = {
  years: string[];
  subjects: string[];
  frequentLaws: Array<{ title: string; count: number }>;
};
type EssayMode = "guided" | "exam";

type EssayBatchAttempt = {
  id: number;
  questionId: number;
  year: string;
  subject: string;
  questionNumber: string;
  answer: string;
  savedAt: string;
};

function coachStageLabelsFor(subject?: string) {
  const normalized = String(subject ?? "").toLowerCase();
  if (normalized.includes("刑法") && !normalized.includes("刑事訴訟")) {
    return ["拆解甲的行為", "處理第一個行為", "處理第二個行為", "處理結果與因果關係", "三段論法練習", "正式作答"];
  }
  if (normalized.includes("公司") || normalized.includes("商事")) {
    return ["辨認法律關係與爭點", "確認公司機關與當事人地位", "找出規範並涵攝事實", "處理學說與實務分歧", "三段論法練習", "正式作答"];
  }
  return ["整理題目事實與爭點", "確認法律關係與請求基礎", "找出規範並涵攝事實", "處理爭議與反面觀點", "三段論法練習", "正式作答"];
}

function defaultCoachProgress(studentCount: number, subject?: string): CoachProgress {
  const coachStageLabels = coachStageLabelsFor(subject);
  const stage = Math.min(Math.max(studentCount, 0), coachStageLabels.length - 1);
  return {
    stage,
    current: coachStageLabels[stage],
    items: coachStageLabels.map((label, index) => ({
      label,
      status: index < stage ? "done" : index === stage ? "current" : "pending",
    })),
    readyForEssay: stage >= 5,
  };
}

const gradingAnimationSteps = [
  { title: "審題定位", note: "確認題目要求與作答範圍" },
  { title: "抓出爭點", note: "對照參考擬答整理關鍵爭點" },
  { title: "核對規範", note: "檢查法條、要件與法律理由" },
  { title: "檢查涵攝", note: "逐段比對事實涵攝與結論" },
  { title: "整理分數", note: "形成解題步驟與下一步修正" },
];

function EssayBatchGrading() {
  const [attempts, setAttempts] = useState<EssayBatchAttempt[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [model, setModel] = useState<EssayModelMode>("sol");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/essay-grading")
      .then(async (response) => {
        const result = (await response.json()) as { attempts?: EssayBatchAttempt[] };
        setAttempts(result.attempts ?? []);
      })
      .catch(() => setMessage("已保存作答暫時無法讀取，請稍後再試。"))
      .finally(() => setLoading(false));
  }, []);

  const allSelected = attempts.length > 0 && attempts.every((attempt) => selectedIds.has(attempt.id));

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(attempts.map((attempt) => attempt.id)));
  }

  function toggle(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function startBatch() {
    const selected = attempts.filter((attempt) => selectedIds.has(attempt.id));
    if (!selected.length || running) return;
    setRunning(true);
    setProgress(0);
    setMessage("");
    let completed = 0;
    let failed = 0;
    for (const attempt of selected) {
      try {
        const response = await fetch("/api/essay-grading", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ questionId: attempt.questionId, answer: attempt.answer, mode: model }),
        });
        if (!response.ok) failed += 1;
      } catch {
        failed += 1;
      }
      completed += 1;
      setProgress(Math.round((completed / selected.length) * 100));
    }
    setRunning(false);
    setMessage(failed ? `批次批改完成 ${completed - failed} 題，${failed} 題失敗，可到歷次批改查看結果。` : `批次批改完成，共 ${completed} 題；結果已保存至我的歷次批改。`);
  }

  return (
    <section className="essay-batch-page" aria-label="批次批改">
      <header className="essay-batch-head">
        <div>
          <p>ESSAY BATCH GRADING</p>
          <h2>批次批改</h2>
          <span>一次勾選多份已保存的二試申論作答，系統會依序完成批改並保存結果。</span>
        </div>
        <strong>{selectedIds.size} 題已選</strong>
      </header>
      <div className="essay-batch-toolbar">
        <label className="essay-batch-select-all"><input type="checkbox" checked={allSelected} onChange={toggleAll} /> 全選</label>
        <label>批改模型<select value={model} onChange={(event) => setModel(event.target.value as EssayModelMode)} disabled={running}><option value="sol">GPT-5.6 Sol</option><option value="claude">Claude Opus 5</option><option value="dual">Sol＋Claude 雙模型覆核</option></select></label>
        <button type="button" className="primary-btn" disabled={!selectedIds.size || running} onClick={() => void startBatch()}>{running ? `批改中 ${progress}%` : "開始批次批改"}</button>
      </div>
      {message && <p className="essay-batch-message">{message}</p>}
      {loading ? <div className="essay-batch-empty">正在讀取已保存的申論作答…</div> : attempts.length ? (
        <div className="essay-batch-list">
          {attempts.map((attempt) => (
            <label className={`essay-batch-card ${selectedIds.has(attempt.id) ? "selected" : ""}`} key={attempt.id}>
              <input type="checkbox" checked={selectedIds.has(attempt.id)} onChange={() => toggle(attempt.id)} disabled={running} />
              <span><b>{attempt.year}｜{attempt.subject}｜第 {attempt.questionNumber} 題</b><small>已保存作答 · {attempt.answer.length.toLocaleString()} 字</small></span>
            </label>
          ))}
        </div>
      ) : <div className="essay-batch-empty">目前沒有可批次處理的已保存作答。先到「二試申論題」完成作答並保存，之後就能在這裡一次批改多題。</div>}
    </section>
  );
}

export function PracticeLab({ initialType }: Props) {
  const [examType, setExamType] = useState<"mcq" | "essay">(initialType);
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [essay, setEssay] = useState("");
  const [essayFeedback, setEssayFeedback] = useState("");
  const [essayGrading, setEssayGrading] = useState<EssayGrading | null>(null);
  const [essayReviews, setEssayReviews] = useState<{
    sol: EssayGrading;
    claude: EssayGrading;
  } | null>(null);
  const [essayComparison, setEssayComparison] =
    useState<EssayComparison | null>(null);
  const [essayModelFailures, setEssayModelFailures] = useState<EssayModelFailure[]>([]);
  const [essayModelMode, setEssayModelMode] =
    useState<EssayModelMode | null>(null);
  const [essayResultMode, setEssayResultMode] =
    useState<EssayModelMode>("sol");
  const [submitting, setSubmitting] = useState(false);
  const [gradingAnimationStep, setGradingAnimationStep] = useState(0);
  const [coachInput, setCoachInput] = useState("");
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachGap, setCoachGap] = useState("");
  const [coachIssue, setCoachIssue] = useState("");
  const [coachRecommendations, setCoachRecommendations] = useState<
    CoachRecommendation[]
  >([]);
  const [coaching, setCoaching] = useState(false);
  const [coachTeachingLevel, setCoachTeachingLevel] = useState<CoachTeachingLevel>("general");
  const [coachModelMode, setCoachModelMode] = useState<CoachModelMode>("luna");
  const [coachSettingsPinned, setCoachSettingsPinned] = useState(false);
  const [coachComparisons, setCoachComparisons] = useState<CoachComparison[]>([]);
  const [coachStarted, setCoachStarted] = useState(false);
  const [coachInputRole, setCoachInputRole] = useState<"student" | "scholar">("student");
  const [coachSettingsOpen, setCoachSettingsOpen] = useState(true);
  const [coachTypingRole, setCoachTypingRole] = useState<"mentor" | "scholar">("mentor");
  const [coachProgress, setCoachProgress] = useState<CoachProgress>(() => defaultCoachProgress(0));
  const coachMessagesRef = useRef<HTMLDivElement | null>(null);
  const coachComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("today");
  const [facets, setFacets] = useState<PracticeFacets>({
    years: [],
    subjects: [],
    frequentLaws: [],
  });
  const [filterYear, setFilterYear] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [excludeAnswered, setExcludeAnswered] = useState(true);
  const [selectedLaw, setSelectedLaw] = useState("");
  const [essayMode, setEssayMode] = useState<EssayMode>("guided");
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [examMinutes, setExamMinutes] = useState(90);
  const [secondsLeft, setSecondsLeft] = useState(90 * 60);
  const [stemOpen, setStemOpen] = useState(true);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [essaySubPage, setEssaySubPage] = useState<"question" | "batch" | "history">("question");
  const essayRef = useRef<HTMLTextAreaElement | null>(null);
  const draftKey = useMemo(
    () => (question ? `silu-essay-draft:${question.id}` : ""),
    [question],
  );
  const clockText = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const essayPages = Math.max(1, Math.ceil(essay.length / 650));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("silu-ai-settings-pinned");
      if (!saved) return;
      const parsed = JSON.parse(saved) as { pinned?: boolean; level?: CoachTeachingLevel; teachingLevel?: CoachTeachingLevel; modelMode?: CoachModelMode };
      const level = parsed.teachingLevel ?? parsed.level;
      if (parsed.pinned !== false && level && parsed.modelMode) {
        setCoachSettingsPinned(true);
        setCoachTeachingLevel(level);
        setCoachModelMode(parsed.modelMode);
      }
    } catch { /* device preference is optional */ }
  }, []);

  function toggleCoachSettingsPinned(checked: boolean) {
    setCoachSettingsPinned(checked);
    try {
      if (!checked) window.localStorage.removeItem("silu-ai-settings-pinned");
      else window.localStorage.setItem("silu-ai-settings-pinned", JSON.stringify({ teachingLevel: coachTeachingLevel, modelMode: coachModelMode }));
    } catch { /* ignore */ }
  }

  function persistCoachSetting(level: CoachTeachingLevel, modelMode: CoachModelMode) {
    if (!coachSettingsPinned) return;
    try { window.localStorage.setItem("silu-ai-settings-pinned", JSON.stringify({ teachingLevel: level, modelMode })); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!submitting) {
      setGradingAnimationStep(0);
      return;
    }
    setGradingAnimationStep(0);
    const timer = window.setInterval(() => {
      setGradingAnimationStep((current) =>
        Math.min(current + 1, gradingAnimationSteps.length - 1),
      );
    }, 850);
    return () => window.clearInterval(timer);
  }, [submitting]);

  function insertEssayMarker(marker: string) {
    const textarea = essayRef.current;
    if (!textarea) {
      setEssay(
        (current) =>
          `${current}${current && !current.endsWith("\n") ? "\n" : ""}${marker}`,
      );
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const prefix = start > 0 && essay[start - 1] !== "\n" ? "\n" : "";
    setEssay(`${essay.slice(0, start)}${prefix}${marker}${essay.slice(end)}`);
    window.requestAnimationFrame(() => {
      const next = start + prefix.length + marker.length;
      textarea.focus();
      textarea.setSelectionRange(next, next);
    });
  }

  function insertEssayText(text: string) {
    const textarea = essayRef.current;
    if (!textarea) {
      setEssay((current) => `${current}${text}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setEssay(`${essay.slice(0, start)}${text}${essay.slice(end)}`);
    window.requestAnimationFrame(() => {
      const next = start + text.length;
      textarea.focus();
      textarea.setSelectionRange(next, next);
    });
  }

  function editEssay(command: "undo" | "redo") {
    essayRef.current?.focus();
    document.execCommand(command);
  }

  async function loadQuestion(
    type = examType,
    filters?: {
      year?: string;
      subject?: string;
      law?: string;
      excludeAnswered?: boolean;
    },
  ) {
    setLoading(true);
    setSelected(null);
    setFeedback("");
    setEssayFeedback("");
    setEssayGrading(null);
    setEssayReviews(null);
    setEssayComparison(null);
    setEssayModelFailures([]);
    setEssayResultMode("sol");
    setEssayModelMode(null);
    setEssay("");
    setCoachInput("");
    setCoachMessages([]);
    setCoachGap("");
    setCoachIssue("");
    setCoachRecommendations([]);
    setCoachComparisons([]);
    setCoachStarted(false);
    setCoachInputRole("student");
    setCoachSettingsOpen(true);
    setCoachTypingRole("mentor");
    setCoachProgress(defaultCoachProgress(0));
    try {
      const params = new URLSearchParams({ type });
      if (filters?.year) params.set("year", filters.year);
      if (filters?.subject) params.set("subject", filters.subject);
      if (filters?.law) params.set("law", filters.law);
      if (filters?.excludeAnswered) params.set("excludeAnswered", "1");
      const response = await fetch(`/api/practice?${params}`);
      const result = (await response.json()) as {
        question?: PracticeQuestion | null;
        message?: string;
      };
      setQuestion(result.question ?? null);
      setCoachProgress(defaultCoachProgress(0, result.question?.subject));
      if (!result.question) setFeedback(result.message ?? "題庫尚未準備完成");
    } catch {
      setQuestion(null);
      setFeedback("題庫暫時無法讀取，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setExamType(initialType);
    void loadQuestion(initialType);
    // The gateway intentionally loads the selected exam type immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialType]);

  useEffect(() => {
    fetch(`/api/practice?type=${examType}&facets=1`)
      .then(async (response) => {
        if (response.ok) setFacets((await response.json()) as PracticeFacets);
      })
      .catch(() => undefined);
  }, [examType]);

  useEffect(() => {
    if (!draftKey || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(draftKey);
    if (saved && !essay) setEssay(saved);
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !essay || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, essay);
      setDraftSavedAt(
        new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftKey, essay]);

  useEffect(() => {
    if (!examStarted || examSubmitted || essayMode !== "exam") return;
    if (secondsLeft <= 0) {
      setExamSubmitted(true);
      void submitEssay();
      return;
    }
    const timer = window.setInterval(
      () => setSecondsLeft((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [examStarted, examSubmitted, essayMode, secondsLeft]);

  useEffect(() => {
    // 只捲動訊息自己的區域，絕不使用 scrollIntoView，避免每次按鈕操作把整個頁面帶走。
    const messagesElement = coachMessagesRef.current;
    if (!messagesElement) return;
    messagesElement.scrollTo({ top: messagesElement.scrollHeight, behavior: "smooth" });
  }, [coachMessages, coaching]);

  useEffect(() => {
    const textarea = coachComposerInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 38), 150)}px`;
  }, [coachInput]);

  function beginMockExam() {
    setEssayMode("exam");
    setExamStarted(true);
    setExamSubmitted(false);
    setSecondsLeft(examMinutes * 60);
    setStemOpen(true);
  }

  function submitMockExam() {
    if (!essay.trim()) return;
    setExamSubmitted(true);
    void submitEssay();
  }

  function chooseMode(mode: PracticeMode) {
    setPracticeMode(mode);
    setFeedback("");
  }

  function startCustomPractice() {
    void loadQuestion("mcq", {
      year: filterYear,
      subject: filterSubject,
      excludeAnswered,
    });
  }

  function startLawPractice(law: string) {
    setSelectedLaw(law);
    void loadQuestion("mcq", { law });
  }

  async function answer(answer: string) {
    if (!question || selected) return;
    setSelected(answer);
    const response = await fetch("/api/practice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.id, answer }),
    });
    const result = (await response.json()) as {
      correct?: boolean;
      correctAnswer?: string;
      guidance?: string;
      error?: string;
    };
    const guidance =
      response.ok && result.correctAnswer
        ? `${result.correct ? "答對了。" : `正確答案是 ${result.correctAnswer}。`} ${result.guidance ?? "先說說你選這個答案的理由。"}`
        : (result.error ?? "作答暫時無法儲存");
    setFeedback(guidance);
    if (response.ok) setCoachMessages([{ role: "mentor", text: guidance }]);
  }

  async function askCoach(
    action: "start" | "coach" | "variation_basic" | "variation_advanced" = "coach",
    suppliedMessage?: CoachMessage,
    options?: { allowWhileCoaching?: boolean },
  ) {
    if (!question || (coaching && !options?.allowWhileCoaching) || (action === "coach" && !coachInput.trim() && !suppliedMessage))
      return;
    const studentMessage =
      suppliedMessage ?? (action === "coach"
        ? { role: coachInputRole, text: coachInput.trim() }
        : null);
    const lastMessage = coachMessages[coachMessages.length - 1];
    const alreadyIncluded = Boolean(
      studentMessage &&
      lastMessage &&
      lastMessage.role === studentMessage.role &&
      lastMessage.text === studentMessage.text,
    );
    const messages = studentMessage && !alreadyIncluded
      ? [...coachMessages, studentMessage]
      : coachMessages;
    if (studentMessage && !alreadyIncluded) setCoachMessages(messages);
    setCoachTypingRole("mentor");
    setCoachSettingsOpen(false);
    setCoaching(true);
    try {
      const response = await fetch("/api/practice-coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          selectedAnswer: selected,
          studentAnswer: essay,
          action,
          messages,
          modelMode: coachModelMode,
          teachingLevel: coachTeachingLevel,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        diagnosedGap?: string;
        keyIssue?: string;
        recommendations?: CoachRecommendation[];
        comparisons?: CoachComparison[];
        progress?: CoachProgress;
        error?: string;
      };
      if (response.ok && result.reply) {
        setCoachMessages((current) => [
          ...current,
          { role: "mentor", text: result.reply! },
        ]);
        setCoachGap(result.diagnosedGap ?? "");
        setCoachIssue(result.keyIssue ?? "");
        setCoachRecommendations(result.recommendations ?? []);
        setCoachComparisons(result.comparisons ?? []);
        setCoachProgress(result.progress ?? defaultCoachProgress(messages.filter((message) => message.role === "student" || message.role === "scholar").length, question.subject));
        setCoachStarted(true);
        setCoachInput("");
        setCoachInputRole("student");
      } else {
        setCoachMessages((current) => [
          ...current,
          {
            role: "mentor",
            text: result.error ?? "教練暫時無法接續，請稍後再試。",
          },
        ]);
      }
    } catch {
      setCoachMessages((current) => [...current, { role: "mentor", text: "教練暫時無法接續，請稍後再試。" }]);
    } finally {
      setCoaching(false);
    }
  }

  async function generateScholarFollowUp() {
    if (!question || coaching || !coachMessages.length) return;
    const latestMentor = [...coachMessages].reverse().find((message) => message.role === "mentor");
    if (!latestMentor) return;
    setCoachTypingRole("scholar");
    setCoachSettingsOpen(false);
    setCoaching(true);
    try {
      const response = await fetch("/api/chat/student-follow-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: latestMentor.text,
          level: coachTeachingLevel,
          subject: question.subject,
          question: question.stem,
          responses: [{ label: "AI 導師", model: coachModelMode, text: latestMentor.text }],
        }),
      });
      const result = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "學霸暫時無法接續");
      // 學霸是對話中的右側角色，內容直接進入訊息串流，不放進學生輸入框。
      const scholarMessage: CoachMessage = { role: "scholar", text: result.reply };
      setCoachMessages((current) => [...current, scholarMessage]);
      // 學霸回答完成後，導師立即自動接續，不再要求使用者按第二個按鈕。
      await askCoach("coach", scholarMessage, { allowWhileCoaching: true });
    } catch (error) {
      setCoachIssue(error instanceof Error ? error.message : "學霸暫時無法接續，請直接回答 AI 導師。");
    } finally {
      setCoaching(false);
    }
  }

  function startEssayCoach() {
    setCoachMessages([]);
    setCoachComparisons([]);
    setCoachProgress(defaultCoachProgress(0, question?.subject));
    setCoachInput("");
    setCoachInputRole("student");
    setCoachStarted(true);
    setCoachSettingsOpen(false);
    void askCoach("start");
  }

  function recommendationUrl(item: CoachRecommendation) {
    if (!item.url || !item.startSeconds) return item.url;
    try {
      const url = new URL(item.url);
      if (url.hostname === "youtu.be")
        url.searchParams.set("t", String(item.startSeconds));
      else if (url.hostname.includes("youtube.com"))
        url.searchParams.set("t", `${item.startSeconds}s`);
      else url.hash = `t=${item.startSeconds}`;
      return url.toString();
    } catch {
      return item.url;
    }
  }

  async function submitEssay() {
    if (!question || !essay.trim() || submitting) return;
    if (!essayModelMode) {
      setEssayFeedback("請先選擇申論批改模型，再開始批改。");
      return;
    }
    setSubmitting(true);
    setEssayFeedback("");
    try {
      const response = await fetch("/api/essay-grading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          answer: essay,
          mode: essayModelMode,
        }),
      });
      const result = (await response.json()) as {
        mode?: EssayModelMode;
        saved?: boolean;
        grading?: EssayGrading;
        reviews?: { sol?: EssayGrading; claude?: EssayGrading };
        comparison?: EssayComparison | null;
        modelFailures?: EssayModelFailure[];
        retryable?: boolean;
        failedModel?: "sol" | "claude";
        source?: { label?: string };
        error?: string;
      };
      if (response.ok && result.grading) {
        const resultMode = result.mode ?? essayModelMode;
        setEssayResultMode(resultMode);
        setEssayGrading(result.grading);
        setEssayModelFailures(result.modelFailures ?? []);
        if (result.reviews?.sol && result.reviews.claude) {
          setEssayReviews({ sol: result.reviews.sol, claude: result.reviews.claude });
          setEssayComparison(result.comparison ?? null);
        } else {
          setEssayReviews(null);
          setEssayComparison(null);
        }
        const failures = result.modelFailures ?? [];
        setEssayFeedback(
          failures.length > 0
            ? (resultMode === "dual" ? "Sol 批改已完成並保存；" : "批改尚未完成；") + failures.map((item) => item.message).join("；") + " 你的答案已保留，可重新選擇模型批改。"
            : resultMode === "dual"
              ? `已完成 GPT-5.6 Sol 與 Claude Opus 5 雙模型覆核。本次依${result.source?.label ?? "老師參考擬答"}批改，結果已自動保存。`
              : `本次使用${resultMode === "claude" ? "Claude Opus 5" : "GPT-5.6 Sol"}，依${result.source?.label ?? "老師參考擬答"}批改，結果已自動保存。`,
        );
      } else {
        setEssayModelFailures(result.failedModel ? [{
          model: result.failedModel,
          label: result.failedModel === "claude" ? "Claude Opus 5" : "GPT-5.6 Sol",
          message: result.error ?? "申論批改暫時無法使用",
          retryable: result.retryable ?? false,
        }] : []);
        setEssayFeedback(
          result.retryable
            ? (result.error ?? "模型服務目前繁忙，請稍後重試。") + " 你的答案已保留，可再次批改。"
            : result.error ?? "申論批改暫時無法使用",
        );
      }
    } catch {
      setEssayFeedback("申論批改暫時無法連線，請稍後重試。你的答案已保留。");
    } finally {
      setSubmitting(false);
    }
  }

  function essayModelPicker() {
    const options: Array<{ value: EssayModelMode; label: string; note: string }> = [
      { value: "sol", label: "GPT-5.6 Sol", note: "預設批改" },
      { value: "claude", label: "Claude Opus 5", note: "另一模型測試" },
      { value: "dual", label: "Sol＋Claude 雙模型覆核", note: "兩份評分並列比較" },
    ];
    return (
      <fieldset className="essay-model-picker" disabled={submitting}>
        <legend>申論批改模型</legend>
        <div>
          {options.map((option) => (
            <label
              key={option.value}
              className={essayModelMode === option.value ? "selected" : ""}
              onClick={() => setEssayModelMode(option.value)}
            >
              <input
                type="radio"
                name="essay-grading-model"
                value={option.value}
                checked={essayModelMode === option.value}
                onChange={() => setEssayModelMode(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </span>
            </label>
          ))}
        </div>
        {essayModelMode === "dual" && (
          <p>兩個模型會取得完全相同的題目、老師擬答與學生答案，完成後分開顯示分數與採分差異。</p>
        )}
        {!essayModelMode && <p>請先選擇一種批改方式；未選擇模型時不會送出批改。</p>}
      </fieldset>
    );
  }

  function renderEssayGrading(grading: EssayGrading, title?: string) {
    return (
      <div className="essay-grading-result">
        {title && (
          <header className="essay-model-result-heading">
            <strong>{title}</strong>
            <span>獨立評分結果</span>
          </header>
        )}
        <div className="essay-score">
          <b>{grading.score}</b>
          <span>/ 100</span>
        </div>
        <p>{grading.overall}</p>
        {grading.solution_steps?.length ? (
          <section className="essay-solution-steps" aria-label="解題過程步驟">
            <header><strong>解題過程步驟</strong><span>從審題一路看到結論</span></header>
            <ol>
              {grading.solution_steps.map((step, index) => (
                <li key={`${step.step}-${step.title}-${index}`}>
                  <div className="essay-solution-step-head"><b>{step.step || index + 1}</b><strong>{step.title}</strong></div>
                  <p><em>本步處理</em>{step.focus}</p>
                  <p><em>解題分析</em>{step.analysis}</p>
                  <p><em>你的表現</em>{step.student_performance}</p>
                  <p><em>下一動作</em>{step.next_action}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <div className="essay-dimensions">
          {grading.dimensions.map((item) => (
            <article key={item.criterion}>
              <strong>
                {item.criterion}　{item.score}/{item.max_score}
              </strong>
              <p>{item.result}</p>
              {item.evidence && <small>你的作答依據：{item.evidence}</small>}
              {item.missing && <small>待補強：{item.missing}</small>}
            </article>
          ))}
        </div>
        {grading.priority_fixes.length > 0 && (
          <div>
            <strong>優先修正</strong>
            <ul>
              {grading.priority_fixes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="essay-next-step">
          <strong>下一步</strong>
          <p>{grading.next_step}</p>
        </div>
      </div>
    );
  }

  function renderGradingAnimation() {
    if (!submitting) return null;
    return (
      <section className="essay-grading-animation" aria-live="polite" aria-label="申論批改進度">
        <div className="essay-grading-animation-head">
          <span className="essay-grading-orbit" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <strong>AI 正在逐步批改你的答案</strong>
            <small>{gradingAnimationSteps[gradingAnimationStep].note}</small>
          </div>
          <b>{gradingAnimationStep + 1}/{gradingAnimationSteps.length}</b>
        </div>
        <ol>
          {gradingAnimationSteps.map((step, index) => (
            <li
              className={index < gradingAnimationStep ? "done" : index === gradingAnimationStep ? "active" : ""}
              key={step.title}
            >
              <span aria-hidden="true">{index < gradingAnimationStep ? "✓" : index + 1}</span>
              <strong>{step.title}</strong>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  function renderEssayResult() {
    if (!essayGrading) return null;
    if (!essayReviews || essayResultMode !== "dual") {
      return renderEssayGrading(
        essayGrading,
        essayResultMode === "claude" ? "Claude Opus 5" : "GPT-5.6 Sol",
      );
    }
    return (
      <section className="essay-dual-review" aria-label="雙模型申論覆核結果">
        <header>
          <div>
            <strong>Sol＋Claude 雙模型覆核</strong>
            <span>兩個模型獨立評分，先看各自判斷，再看採分差異。</span>
          </div>
          {essayComparison && (
            <b>總分差距 {essayComparison.scoreDifference} 分</b>
          )}
        </header>
        <div className="essay-dual-models">
          {renderEssayGrading(essayReviews.sol, "GPT-5.6 Sol")}
          {renderEssayGrading(essayReviews.claude, "Claude Opus 5")}
        </div>
        {essayComparison && (
          <div className="essay-comparison">
            <strong>覆核摘要</strong>
            {essayComparison.agreements.length > 0 && (
              <p>
                <b>配分一致：</b>{essayComparison.agreements.join("、")}
              </p>
            )}
            {essayComparison.differences.length > 0 ? (
              <p>
                <b>配分差異：</b>
                {essayComparison.differences
                  .map((item) => `${item.criterion}（Sol ${item.sol}／Claude ${item.claude}）`)
                  .join("、")}
              </p>
            ) : (
              <p><b>配分差異：</b>兩個模型在已辨識的採分項目沒有分數差異。</p>
            )}
          </div>
        )}
      </section>
    );
  }

  function essayToolbar() {
    return (
      <nav className="essay-writing-toolbar" aria-label="申論作答工具">
        <div className="essay-tool-group essay-level-tools">
          <button type="button" onClick={() => insertEssayMarker("一、")}>
            一、
          </button>
          <button type="button" onClick={() => insertEssayMarker("（一）")}>
            （一）
          </button>
          <button type="button" onClick={() => insertEssayMarker("1.")}>
            1.
          </button>
          <button type="button" onClick={() => insertEssayMarker("（1）")}>
            （1）
          </button>
        </div>
        <div className="essay-tool-group essay-punctuation-tools">
          {[
            "，",
            "。",
            "；",
            "：",
            "！",
            "？",
            "（",
            "）",
            "「",
            "」",
            "『",
            "』",
            "、",
          ].map((mark) => (
            <button
              type="button"
              key={mark}
              onClick={() => insertEssayText(mark)}
            >
              {mark}
            </button>
          ))}
        </div>
        <div className="essay-tool-group essay-edit-tools">
          <button type="button" title="復原" onClick={() => editEssay("undo")}>
            ↶
          </button>
          <button type="button" title="重做" onClick={() => editEssay("redo")}>
            ↷
          </button>
          <button
            type="button"
            title="插入換行"
            onClick={() => insertEssayText("\n")}
          >
            ↵
          </button>
        </div>
      </nav>
    );
  }

  return (
    <section className="practice-lab" aria-label="練真題區">
      <div className="practice-lab-head">
        <div>
          <p>ACTIVE PRACTICE</p>
          <h2>練真題</h2>
          <span>這裡是自己開始練習的地方；完成後會留下作答與弱點紀錄。</span>
        </div>
        <div className="practice-switch">
          <button
            className={examType === "mcq" ? "active" : ""}
            onClick={() => {
              setExamType("mcq");
              setEssaySubPage("question");
              void loadQuestion("mcq");
            }}
          >
            一試選擇題
          </button>
          <button
            className={examType === "essay" ? "active" : ""}
            onClick={() => {
              setExamType("essay");
              setEssaySubPage("question");
              void loadQuestion("essay");
            }}
          >
            二試申論題
          </button>
          {examType === "essay" && (
            <button
              type="button"
              className={essaySubPage === "batch" ? "active" : ""}
              onClick={() => setEssaySubPage("batch")}
            >
              批次批改
            </button>
          )}
          {examType === "essay" && (
            <button
              type="button"
              className={essaySubPage === "history" ? "active" : ""}
              onClick={() => setEssaySubPage("history")}
            >
              我的歷次批改
            </button>
          )}
        </div>
      </div>
      {examType === "essay" && essaySubPage === "history" && <EssayHistory />}
      {examType === "essay" && essaySubPage === "batch" && <EssayBatchGrading />}
      {examType === "mcq" ? (
        <section className="practice-feature-guide" aria-label="一試功能解說">
          <header>
            <div>
              <b>一試怎麼練</b>
              <span>從今天該做的題目開始，也可以依自己的需求選題。</span>
            </div>
            <small>作答後自動留下答對、答錯與弱點紀錄</small>
          </header>
          <div className="practice-feature-grid">
            <button
              type="button"
              className={practiceMode === "today" ? "ready active" : "ready"}
              onClick={() => {
                chooseMode("today");
                void loadQuestion("mcq");
              }}
            >
              <span>01</span>
              <strong>今日練習</strong>
              <p>直接從已審核真題出一題，答完由 AI 追問理由，不只背答案。</p>
              <em>現在開始</em>
            </button>
            <button
              type="button"
              className={practiceMode === "custom" ? "active" : ""}
              onClick={() => chooseMode("custom")}
            >
              <span>02</span>
              <strong>自訂練習</strong>
              <p>依年份、科目與是否排除已作答題目建立練習。</p>
              <em>設定練習範圍 →</em>
            </button>
            <button
              type="button"
              className={practiceMode === "laws" ? "active" : ""}
              onClick={() => chooseMode("laws")}
            >
              <span>03</span>
              <strong>高頻法條</strong>
              <p>依本站已發布真題計算法條出現次數，點法條即可練相關題目。</p>
              <em>查看高頻法條 →</em>
            </button>
          </div>
          {practiceMode === "custom" && (
            <section
              className="practice-mode-panel"
              aria-label="自訂練習篩選器"
            >
              <header>
                <b>設定自訂練習</b>
                <span>選好範圍後，系統會從符合條件的已發布真題抽題。</span>
              </header>
              <div className="practice-filter-row">
                <label>
                  年度
                  <select
                    value={filterYear}
                    onChange={(event) => setFilterYear(event.target.value)}
                  >
                    <option value="">全部年度</option>
                    {facets.years.map((year) => (
                      <option key={year}>{year}</option>
                    ))}
                  </select>
                </label>
                <label>
                  科目
                  <select
                    value={filterSubject}
                    onChange={(event) => setFilterSubject(event.target.value)}
                  >
                    <option value="">全部科目</option>
                    {facets.subjects.map((subject) => (
                      <option key={subject}>{subject}</option>
                    ))}
                  </select>
                </label>
                <label className="practice-checkbox">
                  <input
                    type="checkbox"
                    checked={excludeAnswered}
                    onChange={(event) =>
                      setExcludeAnswered(event.target.checked)
                    }
                  />
                  排除已作答題目
                </label>
                <button type="button" onClick={startCustomPractice}>
                  開始練習
                </button>
              </div>
            </section>
          )}
          {practiceMode === "laws" && (
            <section className="practice-mode-panel" aria-label="高頻法條選題">
              <header>
                <b>高頻法條</b>
                <span>統計目前已發布一試真題題幹中明確出現的法條。</span>
              </header>
              {facets.frequentLaws.length ? (
                <div className="frequent-law-list">
                  {facets.frequentLaws.map((law) => (
                    <button
                      type="button"
                      className={selectedLaw === law.title ? "active" : ""}
                      key={law.title}
                      onClick={() => startLawPractice(law.title)}
                    >
                      <strong>{law.title}</strong>
                      <span>{law.count} 題</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="practice-mode-empty">
                  目前已發布題目尚未辨識到法條標註；後台補齊題目後，這裡會自動產生排行。
                </p>
              )}
            </section>
          )}
        </section>
      ) : essaySubPage === "question" ? (
        <section
          className="practice-feature-guide essay-guide"
          aria-label="二試作答模式"
        >
          <header>
            <div>
              <b>選擇二試練習方式</b>
              <span>
                想學會審題就選引導練習；想測驗實力就進入限時擬真考試。
              </span>
            </div>
            <small>交卷後依已核對的老師參考擬答與評分點批改</small>
          </header>
          <div className="essay-mode-grid">
            <button
              type="button"
              className={essayMode === "guided" ? "active" : ""}
              onClick={() => {
                setEssayMode("guided");
                setExamStarted(false);
              }}
            >
              <span>GUIDED PRACTICE</span>
              <strong>引導練習</strong>
              <p>AI 先陪你辨認人物、行為與爭點，再完成規範、涵攝及結論。</p>
              <em>適合第一次練這類題型</em>
            </button>
            <button
              type="button"
              className={essayMode === "exam" ? "active exam" : "exam"}
              onClick={() => setEssayMode("exam")}
            >
              <span>MOCK EXAM</span>
              <strong>擬真考試</strong>
              <p>全程不提示、限時作答、自動存檔；交卷後才顯示分項批改。</p>
              <em>適合整題實戰測驗</em>
            </button>
          </div>
          {essayMode === "exam" && !examStarted && (
            <div className="mock-exam-setup">
              <label>
                作答時間
                <select
                  value={examMinutes}
                  onChange={(event) =>
                    setExamMinutes(Number(event.target.value))
                  }
                >
                  <option value={30}>30 分鐘</option>
                  <option value={60}>60 分鐘</option>
                  <option value={90}>90 分鐘</option>
                  <option value={120}>120 分鐘</option>
                </select>
              </label>
              <label>
                年度
                <select
                  value={filterYear}
                  onChange={(event) => setFilterYear(event.target.value)}
                >
                  <option value="">全部年度</option>
                  {facets.years.map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </select>
              </label>
              <label>
                科目
                <select
                  value={filterSubject}
                  onChange={(event) => setFilterSubject(event.target.value)}
                >
                  <option value="">全部科目</option>
                  {facets.subjects.map((subject) => (
                    <option key={subject}>{subject}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  void loadQuestion("essay", {
                    year: filterYear,
                    subject: filterSubject,
                  });
                  beginMockExam();
                }}
              >
                開始考試
              </button>
            </div>
          )}
          <ol className="essay-workflow">
            <li>
              <span>1</span>
              <div>
                <strong>審題引導</strong>
                <p>先辨認人物、行為、法律關係與可能爭點。</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>完整作答</strong>
                <p>依考場方式寫出規範、涵攝與結論。</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>採分點批改</strong>
                <p>分別檢查爭點、法條、規範、涵攝、立場及結構表達。</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>安排補強</strong>
                <p>把漏失爭點連回教材、法條與下一次重寫。</p>
              </div>
            </li>
          </ol>
          <p className="grading-scope-note">
            <b>你會看到：</b>
            總分與分項分數、學生原文依據、漏寫內容、優先修正項目及下一步。不同但有法律理由的見解，不會只因文字與擬答不同就判錯。
          </p>
          </section>
      ) : null}
      <div className="practice-lab-note">
        <b>
          {examType === "mcq"
            ? "一試"
            : essayMode === "exam"
              ? "擬真考試"
              : "引導練習"}
        </b>
        <span>
          {examType === "mcq"
            ? "先作答，再說明其他選項為什麼不對。"
            : essayMode === "exam"
              ? "考試中不提供提示，交卷後才會批改。"
              : "先寫出你的審題與答題骨架，再讓 AI 帶你修正。"}
        </span>
        {!(essayMode === "exam" && examStarted) && (
          <button onClick={() => void loadQuestion()}>換一題</button>
        )}
      </div>
      {examType === "essay" &&
        essayMode === "exam" &&
        examStarted &&
        question && (
          <article className="mock-exam-standalone" aria-label="二試擬真考卷">
            <header>
              <div>
                <span>二試線上模擬考卷</span>
                <b>
                  {question.year} · {question.subject} · 第{" "}
                  {question.questionNumber} 題
                </b>
              </div>
              <div className="mock-clock">
                <small>剩餘時間</small>
                <strong className={secondsLeft < 300 ? "urgent" : ""}>
                  {clockText}
                </strong>
              </div>
            </header>
            <div className="mock-exam-actions">
              <button
                type="button"
                onClick={() => setStemOpen((value) => !value)}
              >
                {stemOpen ? "收合題目" : "展開題目"}
              </button>
              <span>
                {draftSavedAt
                  ? `已於 ${draftSavedAt} 自動儲存`
                  : "答案將自動儲存"}
              </span>
              <b>{essay.length}／5,200 字</b>
            </div>
            {stemOpen && (
              <section className="mock-question">
                <strong>題目</strong>
                <p>{question.stem}</p>
              </section>
            )}
            <section className="answer-sheet">
              <div className="answer-sheet-heading">
                <strong>作答區</strong>
                <span>請依正式考試層次作答：一、（一）1.（1）</span>
              </div>
              {essayToolbar()}
              <div className="exam-paper-frame">
                <aside>第 {question.questionNumber} 題｜第 1 頁</aside>
                <textarea
                  ref={essayRef}
                  value={essay}
                  maxLength={5200}
                  onChange={(event) => setEssay(event.target.value)}
                  disabled={examSubmitted}
                  placeholder="請從本頁第 1 行依序開始作答……"
                  aria-label="申論作答內容"
                />
                <em>請從本頁第一行依序開始作答</em>
              </div>
              <footer>
                <span>第 1 頁／共 {essayPages} 頁</span>
                <b>字數 {essay.length}／5,200</b>
                <button
                  type="button"
                  disabled={
                    !essay.trim() ||
                    submitting ||
                    !essayModelMode ||
                    !question.hasTeacherAnswer
                  }
                  onClick={submitMockExam}
                >
                  {submitting
                    ? "正在批改…"
                    : essayGrading
                    ? "再次批改"
                    : examSubmitted
                      ? "已交卷（可重新批改）"
                      : essayModelFailures.length > 0
                        ? "重新嘗試批改"
                      : "確認交卷"}
                </button>
              </footer>
            </section>
            {essayModelPicker()}
            {renderGradingAnimation()}
            {!question.hasTeacherAnswer && (
              <p className="mock-exam-warning">
                本題尚未完成老師擬答核對，目前可作答並儲存，但暫不開放正式交卷批改。
              </p>
            )}
            {essayFeedback && (
              <div className="essay-feedback">
                <strong>AI 申論批改</strong>
                <p>{essayFeedback}</p>
                {essayModelFailures.length > 0 && (
                  <small>失敗模型：{essayModelFailures.map((item) => item.label).join("、")}</small>
                )}
              </div>
            )}
            {renderEssayResult()}
          </article>
        )}
      {loading ? (
        <div className="practice-empty">正在從已審核題庫取題…</div>
      ) : question ? (
        <article className="practice-question-panel">
          <div className="practice-question-meta">
            <span>{examType === "mcq" ? "一試" : "二試"}</span>
            <b>
              {question.year} · {question.subject} · 第{" "}
              {question.questionNumber} 題
            </b>
          </div>
          <p className="practice-question-stem">{question.stem}</p>
          {examType === "mcq" && question.options ? (
            <>
              <div className="practice-option-list">
                {["A", "B", "C", "D"]
                  .filter((key) => question.options?.[key])
                  .map((key) => (
                    <button
                      key={key}
                      disabled={Boolean(selected)}
                      className={selected === key ? "chosen" : ""}
                      onClick={() => void answer(key)}
                    >
                      <b>{key}</b>
                      <span>{question.options?.[key]}</span>
                    </button>
                  ))}
              </div>
              {selected && (
                <section className="practice-coach">
                  <header>
                    <div>
                      <span>真題教練</span>
                      <h3>回答教練，接著把這題學會</h3>
                    </div>
                    <div>
                      <button
                        disabled={coaching}
                        onClick={() => void askCoach("variation_basic")}
                      >
                        基礎變化題
                      </button>
                      <button
                        disabled={coaching}
                        onClick={() => void askCoach("variation_advanced")}
                      >
                        進階變化題
                      </button>
                    </div>
                  </header>
                  <div className="practice-coach-messages">
                    {coachMessages.map((message, index) => (
                      <div
                        className={message.role}
                        key={`${message.role}-${index}`}
                      >
                        <b>{message.role === "mentor" ? "教練" : "我"}</b>
                        <p>{message.text}</p>
                      </div>
                    ))}
                  </div>
                  {(coachIssue || coachGap) && (
                    <div className="practice-diagnosis">
                      {coachIssue && (
                        <p>
                          <b>核心爭點</b>
                          {coachIssue}
                        </p>
                      )}
                      {coachGap && (
                        <p>
                          <b>需要加強</b>
                          {coachGap}
                        </p>
                      )}
                    </div>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void askCoach();
                    }}
                  >
                    <textarea
                      value={coachInput}
                      onChange={(event) => setCoachInput(event.target.value)}
                      placeholder="直接回答教練的問題；不知道也可以說你卡在哪裡"
                      rows={3}
                    />
                    <button disabled={coaching || !coachInput.trim()}>
                      {coaching ? "教練思考中…" : "送出回答"}
                    </button>
                  </form>
                </section>
              )}
            </>
          ) : (
            <div className="essay-practice">
              <div className="essay-source-note">
                {question.hasTeacherAnswer
                  ? `已核對${question.answerSource || "老師參考擬答"}，完成對話後可進入正式作答與 AI 批改。`
                  : "這題尚未完成老師擬答核對，目前可先做自然審題對話；完成擬答核對後才開放分項批改。"}
              </div>
              <section className="essay-chat-mode" aria-label="申論自然對話引導">
                <header className="essay-chat-heading">
                  <div>
                    <span>AI 申論導師｜{coachProgress.current}</span>
                    <h3>{coachStarted ? "像在首頁一樣，一問一答把這題解出來" : "先選好 AI 角色，再開始這題的自然對話"}</h3>
                    <p>你先回答，AI 再依你的程度追問、提示與修正；每完成一段會自動接續下一段，不會只停在列出爭點。</p>
                  </div>
                </header>

                <div className="essay-chat-column">
                    <div ref={coachMessagesRef} className="essay-chat-messages" aria-live="polite">
                      {!coachStarted && <div className="essay-chat-empty"><span className="mentor-avatar">律</span><div><strong>準備好了嗎？</strong><p>請在下方選好學生程度與回答模型，再按「開始對話」；之後會依這一題的科目自然追問，不會套用其他法科的流程。</p></div></div>}
                      {coachMessages.map((message, index) => <div className={`essay-chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.role !== "student" && <span className={`mentor-avatar ${message.role === "scholar" ? "scholar-avatar" : ""}`}>{message.role === "scholar" ? "霸" : "律"}</span>}<div className="essay-chat-bubble"><b>{message.role === "mentor" ? "AI 導師" : message.role === "scholar" ? "AI 學霸" : "我"}</b><p>{message.text}</p></div></div>)}
                      {coaching && <div className={`essay-chat-message ${coachTypingRole}`}><span className={`mentor-avatar ${coachTypingRole === "scholar" ? "scholar-avatar" : ""}`}>{coachTypingRole === "scholar" ? "霸" : "律"}</span><div className="essay-chat-bubble typing"><i /><i /><i /></div></div>}
                    </div>
                    <div className="essay-chat-composer-wrap">
                      <div className={`essay-chat-settings model-mode-switch ${coachSettingsOpen ? "" : "is-collapsed"}`} aria-label="AI 學習設定">
                        <div className="model-mode-heading">
                          <strong>AI 學習設定</strong>
                          <span className="model-mode-summary">{coachTeachingLevel === "general" ? "自由提問" : coachTeachingLevel === "beginner" ? "法律小白" : coachTeachingLevel === "intermediate" ? "基礎考生" : coachTeachingLevel === "advanced" ? "進階考生" : "頂尖學霸"} · {coachModelMode.startsWith("compare-") ? coachModelMode.slice("compare-".length).split("-").map((item) => item === "luna" ? "Luna" : item === "sonnet" ? "Sonnet" : "DeepSeek").join("＋") : coachModelMode === "luna" ? "Luna" : coachModelMode === "sonnet" ? "Claude Sonnet" : "DeepSeek V4-Pro"}{coachSettingsPinned ? " · 已固定" : ""}</span>
                          <button type="button" className="model-settings-toggle" aria-expanded={coachSettingsOpen} onClick={() => setCoachSettingsOpen((open) => !open)}>{coachSettingsOpen ? "收合設定" : "展開設定"}</button>
                        </div>
                        {coachSettingsOpen && <>
                        <div className="model-mode-fields">
                          <label><span>學生</span><select value={coachTeachingLevel} disabled={coachSettingsPinned || coaching} onChange={(event) => { const value = event.target.value as CoachTeachingLevel; setCoachTeachingLevel(value); persistCoachSetting(value, coachModelMode); }}><option value="general">自由提問</option><option value="beginner">法律小白</option><option value="intermediate">基礎考生</option><option value="advanced">進階考生</option><option value="super">頂尖學霸</option></select></label>
                          <label><span>回答</span><select value={coachModelMode.startsWith("compare-") ? coachModelMode.split("-")[1] : coachModelMode} disabled={coachSettingsPinned || coaching} onChange={(event) => { const value = event.target.value as "luna" | "sonnet" | "deepseek"; setCoachModelMode(value); persistCoachSetting(coachTeachingLevel, value); }}><option value="luna">Luna</option><option value="sonnet">Claude Sonnet</option><option value="deepseek">DeepSeek V4-Pro</option></select></label>
                          <label><span>比較</span><select value={coachModelMode.startsWith("compare-") ? coachModelMode.slice("compare-".length) : "none"} disabled={coachSettingsPinned || coaching} onChange={(event) => { const value = event.target.value; const next = value === "none" ? (coachModelMode.startsWith("compare-") ? coachModelMode.split("-")[1] as CoachModelMode : coachModelMode) : `compare-${value}` as CoachModelMode; setCoachModelMode(next); persistCoachSetting(coachTeachingLevel, next); }}><option value="none">不比較</option><option value="luna-sonnet">Luna＋Sonnet</option><option value="luna-deepseek">Luna＋DeepSeek</option><option value="sonnet-deepseek">Sonnet＋DeepSeek</option><option value="luna-sonnet-deepseek">Luna＋Sonnet＋DeepSeek</option></select></label>
                        </div>
                        <div className={`model-settings-pin-row ${coachSettingsPinned ? "is-pinned" : ""}`}><label className="model-settings-pin"><input type="checkbox" checked={coachSettingsPinned} onChange={(event) => toggleCoachSettingsPinned(event.target.checked)} disabled={coaching} /><span>固定此角色與模型</span></label><small>{coachSettingsPinned ? "已固定；取消勾選後即可重新選擇。" : "勾選後會記住目前學生角色、回答模型與比較方式。"}</small></div>
                        </>}
                      </div>
                      <div className="essay-chat-composer-actions">
                        {!coachStarted ? <><span>設定完成後，開始這一題的自然對話</span><button type="button" className="essay-chat-start scholar-start-button" onClick={startEssayCoach} disabled={coaching}>開始對話</button></> : <><span>按下後由 AI 學霸回答；回答完成後 AI 導師會自動接續</span><button type="button" className="scholar-follow-up-button" onClick={() => void generateScholarFollowUp()} disabled={coaching || !coachMessages.length}>讓 AI 學霸回答</button></>}
                      </div>
                      <form className="essay-chat-composer" onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea ref={coachComposerInputRef} value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder={coachStarted ? "回答 AI 導師的問題……" : "開始對話後，這裡會成為你的回答框……"} rows={1} disabled={coaching || !coachStarted} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askCoach(); } }} /><button type="submit" aria-label="送出回答" disabled={coaching || !coachStarted || !coachInput.trim()}>↑</button></form>
                    </div>
                </div>
                {(coachIssue || coachGap) && <div className="practice-diagnosis essay-chat-diagnosis">{coachIssue && <p><b>目前爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}
                {coachComparisons.length > 1 && <div className="essay-coach-comparisons"><b>AI 模型測試比較</b><div>{coachComparisons.map((item) => <article key={`${item.label}-${item.model}`}><strong>{item.label}</strong><small>{item.model}</small><p>{item.text}</p><em>{item.inputTokens + item.outputTokens} tokens · US$ {item.estimatedCostUsd.toFixed(5)}</em></article>)}</div></div>}
              </section>
              {coachProgress.readyForEssay ? <section
                className="guided-answer-sheet"
                aria-label="申論正式作答區"
              >
                <header>
                  <div>
                    <span>正式作答</span>
                    <strong>完成審題後，依考場格式寫出完整答案</strong>
                  </div>
                  <small>建議至少 900 字｜上限 5,200 字</small>
                </header>
                {essayToolbar()}
                <div className="exam-paper-frame">
                  <aside>第 {question.questionNumber} 題｜第 1 頁</aside>
                  <textarea
                    ref={essayRef}
                    value={essay}
                    maxLength={5200}
                    onChange={(event) => setEssay(event.target.value)}
                    placeholder="請從本頁第 1 行依序開始作答……"
                    rows={16}
                  />
                  <em>請從本頁第一行依序開始作答</em>
                </div>
                <footer>
                  <span>第 1 頁／共 {essayPages} 頁</span>
                  <small>{draftSavedAt ? `${draftSavedAt} 已自動儲存` : "答案將自動儲存"}</small>
                  <b>字數 {essay.length}／5,200</b>
                </footer>
              </section> : <section className="guided-answer-locked" aria-label="正式作答尚未解鎖"><strong>完成前面的對話後，解鎖正式作答</strong><p>請先和 AI 逐步完成行為拆解、各段爭點與三段論法；完成後這裡會出現考場格式作答區。</p></section>}
              {coachProgress.readyForEssay && <>
              {essayModelPicker()}
              <button
                className="essay-submit-wide"
                disabled={!coachProgress.readyForEssay || !essay.trim() || submitting || !essayModelMode || !question.hasTeacherAnswer}
                onClick={() => void submitEssay()}
              >
                {submitting
                  ? "AI 分項批改中…"
                  : essayGrading
                  ? "再次批改"
                  : essayModelFailures.length > 0
                    ? "重新嘗試批改"
                    : "送出 AI 分項批改"}
              </button>
              {renderGradingAnimation()}
              {essayFeedback && (
                <div className="essay-feedback">
                  <strong>AI 申論批改</strong>
                  <p>{essayFeedback}</p>
                  {essayModelFailures.length > 0 && (
                    <small>失敗模型：{essayModelFailures.map((item) => item.label).join("、")}</small>
                  )}
                </div>
              )}
              {renderEssayResult()}
              </>}
            </div>
          )}
        </article>
      ) : (
        <div className="practice-empty">
          {feedback || "目前沒有可練習的題目。"}
        </div>
      )}
    </section>
  );
}
