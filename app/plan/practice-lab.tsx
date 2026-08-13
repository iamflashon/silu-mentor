"use client";

import { useEffect, useRef, useState } from "react";
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
  teacherAnswer?: string;
  answerSource?: string;
  answerStatus?: string;
};

type EssayQuestionOption = Pick<PracticeQuestion, "id" | "year" | "subject" | "questionNumber" | "stem" | "hasTeacherAnswer" | "answerSource">;

type EssayGrading = {
  score: number;
  max_score?: number;
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

type EssayModelMode = "luna" | "sol" | "claude" | "dual";
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
type EssayUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsdMicros: number };

type CoachMessage = { role: "mentor" | "student" | "scholar"; text: string };
type CoachTeachingLevel = "general" | "beginner" | "intermediate" | "advanced" | "super";
const coachTeachingLevelLabels: Record<CoachTeachingLevel, string> = {
  general: "一般學生",
  beginner: "法律小白",
  intermediate: "基礎考生",
  advanced: "進階考生",
  super: "頂尖學霸",
};
const coachTeachingLevelShortLabels: Record<CoachTeachingLevel, string> = {
  // 對話徽章隨學生身分切換，避免所有角色固定顯示「霸」。
  general: "生",
  beginner: "白",
  intermediate: "初",
  advanced: "高",
  super: "霸",
};
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
type VariationQuestion = {
  level: "basic" | "advanced";
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  changedFact: string;
};

type Props = { initialType: "mcq" | "essay"; standalone?: boolean; canAdmin?: boolean };
type PracticeMode = "today" | "wrong" | "custom" | "laws";
type PracticeFacets = {
  years: string[];
  subjects: string[];
  frequentLaws: Array<{ title: string; count: number }>;
};
type EssayMode = "guided" | "exam";
type PracticeRecord = {
  id: number;
  questionId: number | null;
  recordDate: string;
  subject: string;
  title: string;
  activityType: string;
  correct: boolean | null;
  weakness: string;
  nextStep: string;
};

const SECOND_STAGE_SUBJECT_ALIASES = [
  "公法",
  "憲法",
  "行政法",
  "民法",
  "民事訴訟法",
  "民訴",
  "刑法",
  "刑事訴訟法",
  "刑訴",
  "商法",
  "商事法",
  "公司法",
  "保險法",
  "證券交易法",
];

const HIDDEN_NON_SECOND_STAGE_SUBJECT_MARKERS = [
  "概要",
  "公務員法",
  "行政學",
  "國文",
  "國際公法",
  "海商法",
  "海洋法",
  "犯罪學",
  "監獄學",
  "強制執行法",
  "立法程序",
];

function isPrimarySecondStageSubject(subject: string) {
  const normalized = subject.replace(/[\s、，,／/與和及・·]/g, "");
  if (!normalized) return false;
  if (HIDDEN_NON_SECOND_STAGE_SUBJECT_MARKERS.some((marker) => normalized.includes(marker))) return false;
  return SECOND_STAGE_SUBJECT_ALIASES.some((alias) => normalized.includes(alias));
}

function essayQuestionSummary(stem: string, maxLength = 34) {
  const normalized = stem
    .replace(/\s+/g, " ")
    .replace(/^[【\[（(]?第?[一二三四五六七八九十\d]+[題、.．：:]?[】\]）)]?\s*/u, "")
    .trim();
  if (!normalized) return "題目摘要尚未建立";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}…`
    : normalized;
}

type EssayBatchAttempt = {
  id: number;
  questionId: number;
  year: string;
  subject: string;
  questionNumber: string;
  answer: string;
  savedAt: string;
};

type GuidedPracticeState = {
  essay?: string;
  coachInput?: string;
  coachMessages?: CoachMessage[];
  coachGap?: string;
  coachIssue?: string;
  coachRecommendations?: CoachRecommendation[];
  coachComparisons?: CoachComparison[];
  coachStarted?: boolean;
  coachInputRole?: "student" | "scholar";
  coachTeachingLevel?: CoachTeachingLevel;
  coachModelMode?: CoachModelMode;
  coachSettingsOpen?: boolean;
  coachProgress?: CoachProgress;
  coachRoundLimit?: number;
  coachExtended?: boolean;
  coachOffTopicCount?: number;
  coachEnded?: boolean;
  essayPickerYear?: string;
  essayPickerSubject?: string;
  essayPickerId?: string;
  essayPickerOpen?: boolean;
  essayModelMode?: EssayModelMode | null;
};

type GuidedResumeSession = {
  questionId: number;
  mode: string;
  status: string;
  updatedAt: string;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  state: GuidedPracticeState;
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
  const model: EssayModelMode = "luna";
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
        <button type="button" className="primary-btn" disabled={!selectedIds.size || running} onClick={() => void startBatch()}>{running ? `批改中 ${progress}%` : "送出批改"}</button>
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

export function PracticeLab({ initialType, standalone = false, canAdmin = false }: Props) {
  const [accountCanAdmin, setAccountCanAdmin] = useState(canAdmin);
  const [examType, setExamType] = useState<"mcq" | "essay">(initialType);
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);

  useEffect(() => {
    if (canAdmin) {
      setAccountCanAdmin(true);
      return;
    }
    fetch("/api/account")
      .then(async (response) => response.ok ? Boolean((await response.json()).member?.canAdmin) : false)
      .then(setAccountCanAdmin)
      .catch(() => setAccountCanAdmin(false));
  }, [canAdmin]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [essay, setEssay] = useState("");
  const [essayFeedback, setEssayFeedback] = useState("");
  const [essayGrading, setEssayGrading] = useState<EssayGrading | null>(null);
  const [essayUsage, setEssayUsage] = useState<EssayUsage[]>([]);
  const [essayReviews, setEssayReviews] = useState<{
    sol: EssayGrading;
    claude: EssayGrading;
  } | null>(null);
  const [essayComparison, setEssayComparison] =
    useState<EssayComparison | null>(null);
  const [essayModelFailures, setEssayModelFailures] = useState<EssayModelFailure[]>([]);
  const [essayModelMode, setEssayModelMode] =
    useState<EssayModelMode | null>("luna");
  const [essayResultMode, setEssayResultMode] =
    useState<EssayModelMode>("luna");
  const [submitting, setSubmitting] = useState(false);
  const [gradingAnimationStep, setGradingAnimationStep] = useState(0);
  const [teacherAnswerOpen, setTeacherAnswerOpen] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [variationQuestion, setVariationQuestion] = useState<VariationQuestion | null>(null);
  const [variationAnswer, setVariationAnswer] = useState<string | null>(null);
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
  const [selectedCoachMessageIndex, setSelectedCoachMessageIndex] = useState<number | null>(null);
  const [coachSettingsOpen, setCoachSettingsOpen] = useState(true);
  const [coachTypingRole, setCoachTypingRole] = useState<"mentor" | "scholar">("mentor");
  const [coachProgress, setCoachProgress] = useState<CoachProgress>(() => defaultCoachProgress(0));
  const [coachRoundLimit, setCoachRoundLimit] = useState(8);
  const [coachExtended, setCoachExtended] = useState(false);
  const [coachOffTopicCount, setCoachOffTopicCount] = useState(0);
  const [coachStageRetryCount, setCoachStageRetryCount] = useState(0);
  const [coachEnded, setCoachEnded] = useState(false);
  const [essayUnlocked, setEssayUnlocked] = useState(false);
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
  const [essayQuestionCatalog, setEssayQuestionCatalog] = useState<EssayQuestionOption[]>([]);
  const [essayPickerYear, setEssayPickerYear] = useState("");
  const [essayPickerSubject, setEssayPickerSubject] = useState("");
  const [essayPickerId, setEssayPickerId] = useState("");
  const [essayPickerOpen, setEssayPickerOpen] = useState(true);
  const [essayPickerLoading, setEssayPickerLoading] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [examMinutes, setExamMinutes] = useState(90);
  const [secondsLeft, setSecondsLeft] = useState(90 * 60);
  const [stemOpen, setStemOpen] = useState(true);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [guidedResumeSessions, setGuidedResumeSessions] = useState<GuidedResumeSession[]>([]);
  const [guidedStateReady, setGuidedStateReady] = useState(false);
  const [guidedSaveStatus, setGuidedSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [essaySubPage, setEssaySubPage] = useState<"question" | "history">("question");
  const [recordPanel, setRecordPanel] = useState<"records" | "weakness" | null>(null);
  const [practiceRecords, setPracticeRecords] = useState<PracticeRecord[]>([]);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const essayRef = useRef<HTMLTextAreaElement | null>(null);
  const clockText = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const essayPages = Math.max(1, Math.ceil(essay.length / 650));
  const secondStageEssayCatalog = essayQuestionCatalog.filter((item) => isPrimarySecondStageSubject(item.subject));
  const essayPickerYears = [...new Set(secondStageEssayCatalog.map((item) => item.year).filter(Boolean))];
  const essayPickerSubjects = [...new Set(secondStageEssayCatalog.filter((item) => !essayPickerYear || item.year === essayPickerYear).map((item) => item.subject).filter(Boolean))];
  const essayPickerQuestions = secondStageEssayCatalog.filter((item) => (!essayPickerYear || item.year === essayPickerYear) && (!essayPickerSubject || item.subject === essayPickerSubject));
  const selectedEssayOption = essayQuestionCatalog.find((item) => String(item.id) === essayPickerId) ?? null;

  async function openRecordPanel(panel: "records" | "weakness") {
    setRecordPanel(panel);
    setRecordLoading(true);
    setRecordError("");
    try {
      const response = await fetch("/api/learning-records");
      if (!response.ok) throw new Error("load failed");
      const result = (await response.json()) as { records?: PracticeRecord[] };
      setPracticeRecords((result.records ?? []).filter((record) => record.activityType === "一試練題"));
    } catch {
      setRecordError("作答紀錄暫時無法讀取，請稍後再試。");
    } finally {
      setRecordLoading(false);
    }
  }

  const answeredPracticeRecords = practiceRecords.filter((record) => record.correct !== null);
  const correctPracticeCount = answeredPracticeRecords.filter((record) => record.correct).length;
  const practiceAccuracy = answeredPracticeRecords.length
    ? Math.round((correctPracticeCount / answeredPracticeRecords.length) * 100)
    : null;
  const weaknessBySubject = [...answeredPracticeRecords.reduce((map, record) => {
    const current = map.get(record.subject) ?? { total: 0, wrong: 0 };
    current.total += 1;
    if (!record.correct) current.wrong += 1;
    map.set(record.subject, current);
    return map;
  }, new Map<string, { total: number; wrong: number }>()).entries()]
    .map(([subject, values]) => ({ subject, ...values, wrongRate: Math.round((values.wrong / values.total) * 100) }))
    .sort((a, b) => b.wrongRate - a.wrongRate || b.wrong - a.wrong);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("silu-ai-settings-pinned");
      if (!saved) return;
      const parsed = JSON.parse(saved) as { pinned?: boolean; level?: CoachTeachingLevel; teachingLevel?: CoachTeachingLevel; modelMode?: CoachModelMode };
      const level = parsed.teachingLevel ?? parsed.level;
      if (level && parsed.modelMode) {
        setCoachSettingsPinned(parsed.pinned !== false);
        setCoachTeachingLevel(level);
        setCoachModelMode(parsed.modelMode);
      }
    } catch { /* device preference is optional */ }
  }, []);

  function toggleCoachSettingsPinned(checked: boolean) {
    setCoachSettingsPinned(checked);
    try {
      window.localStorage.setItem("silu-ai-settings-pinned", JSON.stringify({ pinned: checked, teachingLevel: coachTeachingLevel, modelMode: coachModelMode }));
    } catch { /* ignore */ }
  }

  function persistCoachSetting(level: CoachTeachingLevel, modelMode: CoachModelMode) {
    try { window.localStorage.setItem("silu-ai-settings-pinned", JSON.stringify({ pinned: coachSettingsPinned, teachingLevel: level, modelMode })); } catch { /* ignore */ }
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

  function restoreGuidedSession(questionId: number) {
    let restored = false;
    return fetch(`/api/guided-practice?questionId=${questionId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("引導紀錄讀取失敗");
        const result = (await response.json()) as {
          session?: { state?: GuidedPracticeState; updatedAt?: string } | null;
        };
        const session = result.session;
        const state = session?.state;
        if (state) {
          setEssay(state.essay ?? "");
          setCoachInput(state.coachInput ?? "");
          setCoachMessages(Array.isArray(state.coachMessages) ? state.coachMessages : []);
          setSelectedCoachMessageIndex(null);
          setCoachGap(state.coachGap ?? "");
          setCoachIssue(state.coachIssue ?? "");
          setCoachRecommendations(Array.isArray(state.coachRecommendations) ? state.coachRecommendations : []);
          setCoachComparisons(Array.isArray(state.coachComparisons) ? state.coachComparisons : []);
          setCoachStarted(Boolean(state.coachStarted));
          setCoachInputRole(state.coachInputRole === "scholar" ? "scholar" : "student");
          if (state.coachTeachingLevel) setCoachTeachingLevel(state.coachTeachingLevel);
          if (state.coachModelMode) setCoachModelMode(state.coachModelMode);
          if (typeof state.coachSettingsOpen === "boolean") setCoachSettingsOpen(state.coachSettingsOpen);
          if (state.coachProgress) setCoachProgress(state.coachProgress);
          setCoachRoundLimit(state.coachRoundLimit === 10 ? 10 : 8);
          setCoachExtended(Boolean(state.coachExtended));
          setCoachOffTopicCount(Math.min(3, Math.max(0, Number(state.coachOffTopicCount ?? 0))));
          setCoachEnded(Boolean(state.coachEnded));
          if (typeof state.essayPickerYear === "string") setEssayPickerYear(state.essayPickerYear);
          if (typeof state.essayPickerSubject === "string") setEssayPickerSubject(state.essayPickerSubject);
          if (typeof state.essayPickerId === "string") setEssayPickerId(state.essayPickerId);
          if (typeof state.essayPickerOpen === "boolean") setEssayPickerOpen(state.essayPickerOpen);
          setEssayModelMode("sol");
          setDraftSavedAt(
            session?.updatedAt
              ? new Date(session.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
              : "",
          );
          setGuidedSaveStatus("saved");
        }
        restored = true;
      })
      .catch(() => {
        // 紀錄服務暫時無法連線時，仍可繼續本次練習；下一次輸入會再嘗試保存。
        setGuidedSaveStatus("error");
      })
      .finally(() => setGuidedStateReady(restored));
  }

  function resumeGuidedSession(session: GuidedResumeSession) {
    setEssayMode("guided");
    setEssayPickerYear(session.year);
    setEssayPickerSubject(session.subject);
    setEssayPickerId(String(session.questionId));
    setEssayPickerOpen(false);
    void loadQuestion("essay", { questionId: session.questionId });
  }

  useEffect(() => {
    if (examType !== "essay" || essayMode !== "guided" || !question || !guidedStateReady) return;
    const timer = window.setTimeout(() => {
      setGuidedSaveStatus("saving");
      void fetch("/api/guided-practice", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          mode: "guided",
          state: {
            essay,
            coachInput,
            coachMessages,
            coachGap,
            coachIssue,
            coachRecommendations,
            coachComparisons,
            coachStarted,
            coachInputRole,
            coachTeachingLevel,
            coachModelMode,
            coachSettingsOpen,
            coachProgress,
            coachRoundLimit,
            coachExtended,
            coachOffTopicCount,
            coachEnded,
            essayPickerYear,
            essayPickerSubject,
            essayPickerId,
            essayPickerOpen,
            essayModelMode,
          } satisfies GuidedPracticeState,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("save failed");
          const result = (await response.json()) as { updatedAt?: string };
          setGuidedSaveStatus("saved");
          setDraftSavedAt(
            result.updatedAt
              ? new Date(result.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
          );
        })
        .catch(() => setGuidedSaveStatus("error"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    examType,
    essayMode,
    question,
    guidedStateReady,
    essay,
    coachInput,
    coachMessages,
    coachGap,
    coachIssue,
    coachRecommendations,
    coachComparisons,
    coachStarted,
    coachInputRole,
    coachTeachingLevel,
    coachModelMode,
    coachSettingsOpen,
    coachProgress,
    coachRoundLimit,
    coachExtended,
    coachOffTopicCount,
    coachEnded,
    essayPickerYear,
    essayPickerSubject,
    essayPickerId,
    essayPickerOpen,
    essayModelMode,
  ]);

  async function loadQuestion(
    type = examType,
    filters?: {
      year?: string;
      subject?: string;
      law?: string;
      excludeAnswered?: boolean;
      wrongOnly?: boolean;
      questionId?: number;
    },
  ) {
    // 指定題目時先清除舊題，避免選題預覽已更新、下方仍暫留上一題。
    if (filters?.questionId) setQuestion(null);
    setGuidedStateReady(false);
    setGuidedSaveStatus("idle");
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
    setVariationQuestion(null);
    setVariationAnswer(null);
    setSelectedCoachMessageIndex(null);
    setCoachGap("");
    setCoachIssue("");
    setCoachRecommendations([]);
    setCoachComparisons([]);
    setCoachStarted(false);
    setCoachInputRole("student");
    setCoachSettingsOpen(true);
    setCoachTypingRole("mentor");
    setCoachProgress(defaultCoachProgress(0));
    setCoachRoundLimit(8);
    setCoachExtended(false);
    setCoachOffTopicCount(0);
    setCoachEnded(false);
    try {
      const params = new URLSearchParams({ type });
      if (filters?.year) params.set("year", filters.year);
      if (filters?.subject) params.set("subject", filters.subject);
      if (filters?.law) params.set("law", filters.law);
      if (filters?.excludeAnswered) params.set("excludeAnswered", "1");
      if (filters?.wrongOnly) params.set("wrongOnly", "1");
      if (filters?.questionId) params.set("questionId", String(filters.questionId));
      const response = await fetch(`/api/practice?${params}`);
      const result = (await response.json()) as {
        question?: PracticeQuestion | null;
        message?: string;
      };
      setQuestion(result.question ?? null);
      setCoachProgress(defaultCoachProgress(0, result.question?.subject));
      if (!result.question) {
        setGuidedStateReady(false);
        setFeedback(result.message ?? "題庫尚未準備完成");
      } else if (type === "essay") {
        // The essay grader currently has one fixed model and no visible picker.
        // Re-establish that mode after loading a new question so the submit
        // button never depends on stale picker state.
        setEssayModelMode("sol");
        await restoreGuidedSession(result.question.id);
      } else {
        setGuidedStateReady(false);
      }
    } catch {
      setQuestion(null);
      setFeedback("題庫暫時無法讀取，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setExamType(initialType);
    if (initialType === "essay") {
      setQuestion(null);
      setGuidedStateReady(false);
      setEssayPickerOpen(true);
      setCoachMessages([]);
      setCoachStarted(false);
      setCoachProgress(defaultCoachProgress(0));
      setFeedback("");
    } else {
      void loadQuestion(initialType);
    }
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
    if (examType !== "essay") return;
    setEssayPickerLoading(true);
    fetch("/api/practice?type=essay&list=1")
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { questions?: EssayQuestionOption[] };
        setEssayQuestionCatalog(result.questions ?? []);
      })
      .catch(() => setEssayQuestionCatalog([]))
      .finally(() => setEssayPickerLoading(false));
    fetch("/api/guided-practice")
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { sessions?: GuidedResumeSession[] };
        setGuidedResumeSessions(result.sessions ?? []);
      })
      .catch(() => setGuidedResumeSessions([]));
  }, [examType]);

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

  function clearEssayQuestion() {
    setQuestion(null);
    setGuidedStateReady(false);
    setGuidedSaveStatus("idle");
    setEssay("");
    setCoachInput("");
    setCoachMessages([]);
    setCoachGap("");
    setCoachIssue("");
    setCoachRecommendations([]);
    setCoachComparisons([]);
    setCoachStarted(false);
    setCoachProgress(defaultCoachProgress(0));
    setExamStarted(false);
    setExamSubmitted(false);
    setFeedback("");
  }

  async function chooseEssayQuestion(questionId: number) {
    setSelectedCoachMessageIndex(null);
    setEssayPickerId(String(questionId));
    setEssayPickerOpen(false);
    await loadQuestion("essay", { questionId });
    if (essayMode === "exam") beginMockExam();
  }

  function reopenEssayPicker() {
    setEssayPickerOpen(true);
    setExamStarted(false);
  }

  async function clearAllGuidedPractice() {
    if (!window.confirm("確定要清空全部引導學習紀錄並重新開始嗎？此動作無法復原，但不會刪除模擬考試與其他學習紀錄。")) return;
    setGuidedStateReady(false);
    setGuidedSaveStatus("saving");
    try {
      const response = await fetch("/api/guided-practice", { method: "DELETE" });
      if (!response.ok) throw new Error("clear failed");
      clearEssayQuestion();
      setCoachRoundLimit(8);
      setCoachExtended(false);
      setCoachOffTopicCount(0);
      setCoachEnded(false);
      setEssayPickerYear("");
      setEssayPickerSubject("");
      setEssayPickerId("");
      setEssayPickerOpen(true);
      setGuidedResumeSessions([]);
      setDraftSavedAt("");
      setGuidedSaveStatus("idle");
    } catch {
      setGuidedSaveStatus("error");
      window.alert("引導學習紀錄暫時無法清空，請稍後再試。");
    }
  }

  function startCustomPractice() {
    void loadQuestion("mcq", {
      year: filterYear,
      subject: filterSubject,
      excludeAnswered,
    });
  }

  function startWrongPractice() {
    chooseMode("wrong");
    void loadQuestion("mcq", { wrongOnly: true });
  }

  function retryWrongQuestion(questionId: number | null) {
    if (!questionId) return;
    setRecordPanel(null);
    chooseMode("wrong");
    void loadQuestion("mcq", { questionId });
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
    action: "start" | "coach" | "variation_basic" | "variation_advanced" | "subquestion_summary" | "end_summary" = "coach",
    suppliedMessage?: CoachMessage,
    options?: { allowWhileCoaching?: boolean },
  ) {
    if (!question || coachEnded || (coaching && !options?.allowWhileCoaching) || ((action === "coach" || action === "subquestion_summary") && !coachInput.trim() && !suppliedMessage))
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
          roundLimit: coachRoundLimit,
          offTopicCount: coachOffTopicCount,
          currentStage: coachProgress.stage,
          currentStageRetryCount: coachStageRetryCount,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        variation?: VariationQuestion;
        diagnosedGap?: string;
        keyIssue?: string;
        recommendations?: CoachRecommendation[];
        comparisons?: CoachComparison[];
        progress?: CoachProgress;
        relevance?: "related" | "drift" | "off_topic";
        offTopicCount?: number;
        ended?: boolean;
        answerRevealed?: boolean;
        currentStageRetryCount?: number;
        error?: string;
      };
      if (response.ok && result.variation) {
        setVariationQuestion(result.variation);
        setVariationAnswer(null);
        setCoachStarted(true);
      } else if (response.ok && result.reply) {
        setCoachMessages((current) => [
          ...current,
          { role: "mentor", text: result.reply! },
        ]);
        setCoachGap(result.diagnosedGap ?? "");
        setCoachIssue(result.keyIssue ?? "");
        setCoachRecommendations(result.recommendations ?? []);
        setCoachComparisons(result.comparisons ?? []);
        setCoachProgress(result.progress ?? defaultCoachProgress(messages.filter((message) => message.role === "student" || message.role === "scholar").length, question.subject));
        if ((result.progress?.stage ?? coachProgress.stage) <= coachProgress.stage && messages.filter((message) => message.role === "student" || message.role === "scholar").length >= coachRoundLimit - 1) {
          setCoachRoundLimit((current) => current + 2);
          setCoachExtended(true);
        }
        setCoachOffTopicCount(result.offTopicCount ?? coachOffTopicCount);
        setCoachStageRetryCount(result.currentStageRetryCount ?? coachStageRetryCount);
        if (result.ended || action === "end_summary") setCoachEnded(true);
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

  function startVariation(action: "variation_basic" | "variation_advanced") {
    // A variation is a fresh attempt. Keep the original selected answer only as
    // request context, but remove its revealed answer and coaching analysis from
    // the screen before the new question is generated.
    setFeedback("");
    setCoachMessages([]);
    setCoachGap("");
    setCoachIssue("");
    setCoachRecommendations([]);
    setCoachComparisons([]);
    setCoachInput("");
    setVariationQuestion(null);
    setVariationAnswer(null);
    void askCoach(action);
  }

  async function generateScholarFollowUp() {
    // This is an administrator-only model-evaluation helper. It must never
    // impersonate a real student or enter generated text into student history.
    if (!accountCanAdmin || !question || coaching) return;
    // 沒有指定訊息時，模擬學生回答最新一則導師訊息；
    // 指定訊息時，只針對該則導師的問題作答，不反問或另開爭點。
    const mentorIndexes = [...coachMessages].map((message, index) => message.role === "mentor" ? index : -1).filter((index) => index >= 0);
    const targetIndex = selectedCoachMessageIndex !== null && coachMessages[selectedCoachMessageIndex]?.role === "mentor"
      ? selectedCoachMessageIndex
      : mentorIndexes[mentorIndexes.length - 1] ?? -1;
    const selectedMessage = targetIndex >= 0 ? coachMessages[targetIndex] : null;
    if (!selectedMessage) return;
    setCoachTypingRole("scholar");
    setCoachSettingsOpen(false);
    setCoaching(true);
    try {
      const response = await fetch("/api/chat/student-follow-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: selectedCoachMessageIndex === null
            ? `請扮演學生，直接回答最新一則 AI 導師提出的問題。先表明判斷，再依題目事實簡短說明理由；不得反問、不得另開爭點，也不要輸出內部分析或處理說明：\n${selectedMessage.text}`
            : `學生指定要回答這一則 AI 導師訊息。請只針對這則訊息中的問題正面作答；先表明判斷，再依題目事實簡短說明理由。不得反問、不得另開爭點，也不要輸出「選取內容」、內部分析或處理說明：\n${selectedMessage.text}`,
          level: coachTeachingLevel,
          subject: question.subject,
          question: `${question.stem}\n${question.options ? Object.entries(question.options).map(([key, value]) => `${key}. ${value}`).join("\n") : ""}`.trim(),
          responses: [{ label: selectedMessage.role === "mentor" ? "AI 導師" : selectedMessage.role === "scholar" ? "AI 學霸" : "學生指定訊息", model: coachModelMode, text: selectedMessage.text }],
        }),
      });
      const result = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "學霸暫時無法接續");
      // 學霸是對話中的右側角色，內容直接進入訊息串流，不放進學生輸入框。
      const scholarMessage: CoachMessage = { role: "scholar", text: result.reply };
      setCoachMessages((current) => [...current, scholarMessage]);
      setSelectedCoachMessageIndex(null);
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
    setSelectedCoachMessageIndex(null);
    setCoachComparisons([]);
    setCoachProgress(defaultCoachProgress(0, question?.subject));
    setCoachInput("");
    setCoachInputRole("student");
    setCoachStarted(true);
    setCoachRoundLimit(8);
    setCoachExtended(false);
    setCoachOffTopicCount(0);
    setCoachStageRetryCount(0);
    setCoachEnded(false);
    setCoachSettingsOpen(false);
    void askCoach("start");
  }

  function extendCoachConversation() {
    if (coachExtended || coachEnded || coachRoundLimit >= 10) return;
    setCoachRoundLimit(10);
    setCoachExtended(true);
  }

  function sendGuidedCoachReply(kind: "hint" | "smaller_step") {
    const text = kind === "hint"
      ? "我還沒有把握。請先給我一個思考提示，不要直接公布完整答案，提示後再讓我回答。"
      : "這一步我不確定，請把剛才的問題拆成一個更小、可以直接判斷的問題，再讓我回答。";
    void askCoach("coach", { role: "student", text });
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
    const selectedMode: EssayModelMode = "luna";
    setSubmitting(true);
    setEssayFeedback("");
    try {
      const response = await fetch("/api/essay-grading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          answer: essay,
          mode: selectedMode,
        }),
      });
      const result = (await response.json()) as {
        mode?: EssayModelMode;
        saved?: boolean;
        grading?: EssayGrading;
        reviews?: { sol?: EssayGrading; claude?: EssayGrading };
        comparison?: EssayComparison | null;
        modelFailures?: EssayModelFailure[];
        usage?: EssayUsage[];
        retryable?: boolean;
        failedModel?: "sol" | "claude";
        source?: { label?: string };
        error?: string;
      };
      if (response.ok && result.grading) {
        const resultMode = result.mode ?? selectedMode;
        setEssayResultMode(resultMode);
        setEssayGrading(result.grading);
        setEssayUsage(result.usage ?? []);
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
              : `本次使用${resultMode === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna"}，依${result.source?.label ?? "老師參考擬答"}批改，結果已自動保存。`,
        );
      } else {
        setEssayModelFailures(result.failedModel ? [{
          model: result.failedModel,
          label: result.failedModel === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna",
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
    return null;
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
          <span>/ {grading.max_score ?? (grading.dimensions.reduce((sum, item) => sum + item.max_score, 0) || 100)}</span>
        </div>
        {essayUsage.length > 0 && (
          <div className="essay-usage-meta" aria-label="本次申論批改用量">
            {essayUsage.map((item) => <span key={`${item.model}-${item.estimatedCostUsdMicros}`}><b>{item.model.includes("opus") ? "Claude Opus 5" : item.model.includes("luna") ? "GPT-5.6 Luna" : "GPT-5.6 Sol"}</b> · 輸入 {item.inputTokens.toLocaleString()} · 輸出 {item.outputTokens.toLocaleString()} · 合計 {(item.inputTokens + item.outputTokens).toLocaleString()} tokens · US$ {(item.estimatedCostUsdMicros / 1_000_000).toFixed(5)}</span>)}
          </div>
        )}
        <p>{grading.overall}</p>
        <div className="essay-diagnostic-note">
          <strong>本次只診斷你的原答案</strong>
          <span>依老師資料檢查得分點與推論缺口，不另生成 AI 擬答。</span>
        </div>
        <div className="essay-dimensions">
          <header className="essay-dimensions-heading">
            <strong>六項答題診斷</strong>
            <span>已做到／寫錯／遺漏／如何補強</span>
          </header>
          {grading.dimensions.map((item) => (
            <article key={item.criterion}>
              <strong>
                {item.criterion}　{item.score}/{item.max_score}
              </strong>
              <p>{item.result}</p>
              {item.evidence && <small><b>已做到／原文證據：</b>{item.evidence}</small>}
              {item.missing && <small><b>寫錯、遺漏與補強：</b>{item.missing}</small>}
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
        {question?.teacherAnswer ? (
          <details className="essay-teacher-answer" open={teacherAnswerOpen} onToggle={(event) => setTeacherAnswerOpen(event.currentTarget.open)}>
            <summary>查看老師擬答</summary>
            <div>
              <strong>{question.answerSource || "老師參考擬答"}</strong>
              <p>{question.teacherAnswer}</p>
              <small>老師擬答是本次批改基準；AI 診斷不取代老師採說。</small>
            </div>
          </details>
        ) : null}
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
        essayResultMode === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna",
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
    <section className="practice-lab" aria-label={initialType === "essay" ? "寫申論區" : "練真題區"}>
      <div className="practice-lab-head">
        <div>
          <p>{initialType === "essay" ? "ESSAY PRACTICE" : "ACTIVE PRACTICE"}</p>
          <h2>{initialType === "essay" ? "寫申論" : "練真題"}</h2>
          <span>{initialType === "essay" ? "先學會拆題與涵攝，再由你決定何時開始模考擬答。" : "練真題只保留一試選擇題；完成後會留下作答與弱點紀錄。"}</span>
        </div>
        <div className="practice-head-actions">
          {examType === "mcq" && (
            <div className="practice-record-actions" aria-label="作答紀錄與弱點分析">
              <button type="button" onClick={() => void openRecordPanel("records")}>作答紀錄</button>
              <button type="button" onClick={() => void openRecordPanel("weakness")}>弱點分析</button>
            </div>
          )}
          <div className="practice-switch">
          {!standalone && <button
            className={examType === "mcq" ? "active" : ""}
            onClick={() => {
              setExamType("mcq");
              setEssaySubPage("question");
              void loadQuestion("mcq");
            }}
          >
            一試選擇題
          </button>}
          {!standalone && <button
            className={examType === "essay" ? "active" : ""}
            onClick={() => {
              setExamType("essay");
              setEssaySubPage("question");
              clearEssayQuestion();
              setEssayPickerOpen(true);
            }}
          >
            二試申論題
          </button>}
          {examType === "essay" && (
            <button
              type="button"
              className={essaySubPage === "history" ? "active" : ""}
              onClick={() => setEssaySubPage(essaySubPage === "history" ? "question" : "history")}
            >
              {essaySubPage === "history" ? "← 返回寫申論" : "我的歷次批改"}
            </button>
          )}
          </div>
        </div>
      </div>
      {recordPanel && (
        <div className="practice-record-overlay" role="dialog" aria-modal="true" aria-label={recordPanel === "records" ? "作答紀錄" : "弱點分析"} onMouseDown={(event) => { if (event.currentTarget === event.target) setRecordPanel(null); }}>
          <section className="practice-record-panel">
            <header>
              <div>
                <span>MY PRACTICE</span>
                <h3>{recordPanel === "records" ? "作答紀錄" : "弱點分析"}</h3>
              </div>
              <button type="button" aria-label="關閉" onClick={() => setRecordPanel(null)}>×</button>
            </header>
            <nav>
              <button type="button" className={recordPanel === "records" ? "active" : ""} onClick={() => setRecordPanel("records")}>作答紀錄</button>
              <button type="button" className={recordPanel === "weakness" ? "active" : ""} onClick={() => setRecordPanel("weakness")}>弱點分析</button>
            </nav>
            {recordLoading ? <p className="practice-record-empty">正在整理你的作答資料…</p> : recordError ? <p className="practice-record-empty is-error">{recordError}</p> : recordPanel === "records" ? (
              practiceRecords.length ? <div className="practice-record-list">
                {practiceRecords.map((record) => <article key={record.id}>
                  <span className={record.correct ? "is-correct" : "is-wrong"}>{record.correct ? "答對" : "答錯"}</span>
                  <div><b>{record.title}</b><small>{record.recordDate} · {record.subject}</small>{record.nextStep && <p>{record.nextStep}</p>}</div>
                  {!record.correct && record.questionId && <button type="button" className="practice-retry-button" onClick={() => retryWrongQuestion(record.questionId)}>重做本題</button>}
                </article>)}
              </div> : <p className="practice-record-empty">還沒有一試作答紀錄。完成第一題後，系統會自動保存在這裡。</p>
            ) : (
              <div className="practice-weakness-view">
                <div className="practice-weakness-summary">
                  <article><strong>{answeredPracticeRecords.length}</strong><span>累積作答</span></article>
                  <article><strong>{practiceAccuracy === null ? "—" : `${practiceAccuracy}%`}</strong><span>目前正確率</span></article>
                  <article><strong>{answeredPracticeRecords.length - correctPracticeCount}</strong><span>需要回顧</span></article>
                </div>
                {weaknessBySubject.length ? <div className="practice-weakness-list">
                  <header><b>各科錯題狀況</b><span>依錯題率排序</span></header>
                  {weaknessBySubject.map((item) => <article key={item.subject}>
                    <div><b>{item.subject}</b><span>{item.wrong}／{item.total} 題答錯</span></div>
                    <div className="practice-weakness-track"><i style={{ width: `${item.wrongRate}%` }} /></div>
                    <strong>{item.wrongRate}%</strong>
                  </article>)}
                  <p>優先重做錯題率較高的科目；每次作答後，分析會自動更新。</p>
                </div> : <p className="practice-record-empty">作答樣本還不足。先完成幾題，系統才會開始辨認穩定弱點。</p>}
              </div>
            )}
          </section>
        </div>
      )}
      {examType === "essay" && essaySubPage === "history" && <EssayHistory onBack={() => setEssaySubPage("question")} />}
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
              className={practiceMode === "wrong" ? "active" : ""}
              onClick={startWrongPractice}
            >
              <span>02</span>
              <strong>練錯題</strong>
              <p>重做最近一次仍答錯的題目；答對後標記已訂正，歷史紀錄仍會保留。</p>
              <em>開始訂正 →</em>
            </button>
            <button
              type="button"
              className={practiceMode === "custom" ? "active" : ""}
              onClick={() => chooseMode("custom")}
            >
              <span>03</span>
              <strong>自訂練習</strong>
              <p>依年份、科目與是否排除已作答題目建立練習。</p>
              <em>設定練習範圍 →</em>
            </button>
            <button
              type="button"
              className={practiceMode === "laws" ? "active" : ""}
              onClick={() => chooseMode("laws")}
            >
              <span>04</span>
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
                setEssayPickerOpen(!question);
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
              onClick={() => { setEssayMode("exam"); setEssayPickerOpen(!question); }}
            >
              <span>MOCK EXAM</span>
              <strong>擬真考試</strong>
              <p>全程不提示、限時作答、自動存檔；交卷後才顯示分項批改。</p>
              <em>適合整題實戰測驗</em>
            </button>
          </div>
          <div className={`essay-mode-mobile-summary ${essayMode === "exam" ? "exam" : "guided"}`} aria-live="polite">
            <span>{essayMode === "exam" ? "MOCK EXAM" : "GUIDED PRACTICE"}</span>
            <strong>{essayMode === "exam" ? "擬真考試" : "引導練習"}</strong>
            <p>
              {essayMode === "exam"
                ? "全程不提示、限時作答、自動存檔；交卷後才顯示分項批改。"
                : "AI 先陪你辨認人物、行為與爭點，再完成規範、涵攝及結論。"}
            </p>
            <em>{essayMode === "exam" ? "適合整題實戰測驗" : "適合第一次練這類題型"}</em>
          </div>
          <section className={`essay-question-picker ${essayPickerOpen || !question ? "is-open" : ""}`} aria-label="選擇二試申論題">
            <header>
              <div>
                <b>先挑一題，再開始練習</b>
                <span>請依「年度 → 類科 → 題目」選擇，不會由系統自動出題。</span>
              </div>
              <div className="essay-picker-header-actions">
                {essayMode === "guided" && (question || guidedResumeSessions.length > 0) && <button type="button" className="danger-subtle" onClick={() => void clearAllGuidedPractice()}>清空全部重學</button>}
                {!essayPickerOpen && question && <button type="button" onClick={reopenEssayPicker}>重新挑題</button>}
              </div>
            </header>
            {(essayPickerOpen || !question) && <>
              {essayMode === "guided" && guidedResumeSessions.length > 0 && (
                <div className="guided-resume-panel" aria-label="繼續上次的引導學習">
                  <div>
                    <strong>繼續上次的引導</strong>
                    <span>中斷的對話、目前階段與作答內容都已保存。</span>
                  </div>
                  <div className="guided-resume-list">
                    {guidedResumeSessions.slice(0, 3).map((session) => (
                      <button type="button" key={session.questionId} onClick={() => resumeGuidedSession(session)}>
                        <span>{session.year}｜{session.subject}｜第 {session.questionNumber} 題</span>
                        <small>繼續引導 →</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="essay-question-picker-fields">
                <label><span>年度</span><select value={essayPickerYear} onChange={(event) => { setEssayPickerYear(event.target.value); setEssayPickerSubject(""); setEssayPickerId(""); }} disabled={essayPickerLoading}><option value="">選擇年度</option>{essayPickerYears.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label>
                <label><span>類科</span><select value={essayPickerSubject} onChange={(event) => { setEssayPickerSubject(event.target.value); setEssayPickerId(""); }} disabled={!essayPickerYear || essayPickerLoading}><option value="">選擇類科</option>{essayPickerSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
                <label><span>題目</span><select value={essayPickerId} onChange={(event) => setEssayPickerId(event.target.value)} disabled={!essayPickerSubject || essayPickerLoading}><option value="">選擇題目</option>{essayPickerQuestions.map((item) => <option key={item.id} value={item.id}>第 {item.questionNumber} 題｜{essayQuestionSummary(item.stem)}</option>)}</select></label>
              </div>
              {essayPickerLoading && <p className="essay-question-picker-status">正在讀取已發布的二試題目…</p>}
              {!essayPickerLoading && essayPickerYear && essayPickerSubject && !essayPickerQuestions.length && <p className="essay-question-picker-status">這個年度與類科目前沒有可選題目。</p>}
              {selectedEssayOption && String(selectedEssayOption.id) === essayPickerId && <div className="essay-question-picker-preview"><div><b>{selectedEssayOption.year} 年｜{selectedEssayOption.subject}｜第 {selectedEssayOption.questionNumber} 題</b><p>{selectedEssayOption.stem.slice(0, 180)}{selectedEssayOption.stem.length > 180 ? "…" : ""}</p></div><button type="button" className="essay-question-picker-confirm" disabled={loading} onClick={() => void chooseEssayQuestion(selectedEssayOption.id)}>{loading ? "正在載入這一題…" : essayMode === "exam" ? "使用這一題，進入擬真考試" : "使用這一題，開始引導"}</button></div>}
            </>}
          </section>
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
              <div className="mock-exam-selected-question">
                <span>本次考題</span>
                <b>{question ? `${question.year} 年｜${question.subject}｜第 ${question.questionNumber} 題` : "請先在上方選定題目"}</b>
              </div>
              <button
                type="button"
                disabled={!question || loading || (essayPickerId && String(question.id) !== essayPickerId)}
                onClick={beginMockExam}
              >
                開始考試
              </button>
            </div>
          )}
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
        {examType === "mcq" && <button onClick={() => void loadQuestion()}>換一題</button>}
        {examType === "essay" && question && !(essayMode === "exam" && examStarted) && <button onClick={reopenEssayPicker}>重新挑題</button>}
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
                    !question.hasTeacherAnswer
                  }
                  onClick={submitMockExam}
                >
                  {submitting ? "批改中…" : essayGrading ? "重新批改" : "送出批改"}
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
                        onClick={() => startVariation("variation_basic")}
                      >
                        基礎變化題
                      </button>
                      <button
                        disabled={coaching}
                        onClick={() => startVariation("variation_advanced")}
                      >
                        進階變化題
                      </button>
                    </div>
                  </header>
                  {variationQuestion && (
                    <section className="coach-variation-question" aria-live="polite">
                      <div className="coach-variation-heading">
                        <div>
                          <span>{variationQuestion.level === "basic" ? "基礎模擬變化題" : "進階模擬變化題"}</span>
                          <small>本題為 AI 依原題生成，非歷屆真題</small>
                        </div>
                        <button type="button" onClick={() => { setVariationQuestion(null); setVariationAnswer(null); }}>關閉</button>
                      </div>
                      <p>{variationQuestion.stem}</p>
                      <div className="coach-variation-options">
                        {(["A", "B", "C", "D"] as const).map((key) => (
                          <button
                            type="button"
                            key={key}
                            disabled={Boolean(variationAnswer)}
                            className={variationAnswer === key ? "chosen" : ""}
                            onClick={() => setVariationAnswer(key)}
                          >
                            <b>{key}</b><span>{variationQuestion.options[key]}</span>
                          </button>
                        ))}
                      </div>
                      {variationAnswer && (
                        <div className={variationAnswer === variationQuestion.correctAnswer ? "variation-result correct" : "variation-result incorrect"}>
                          <strong>{variationAnswer === variationQuestion.correctAnswer ? "答對了" : `答錯了，正確答案是 ${variationQuestion.correctAnswer}`}</strong>
                          <p>{variationQuestion.explanation}</p>
                          <small>本題變更：{variationQuestion.changedFact}</small>
                        </div>
                      )}
                    </section>
                  )}
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
                    <h3>{coachStarted ? "AI 導師陪你把這題拆解出來" : accountCanAdmin ? "設定管理測試條件，再開始這題的自然對話" : "開始這題的自然對話"}</h3>
                    <p>你先回答，AI 再依你的程度追問、提示與修正；每完成一段會自動接續下一段，不會只停在列出爭點。</p>
                    <small className={`guided-save-status is-${guidedSaveStatus}`} aria-live="polite">
                      {guidedSaveStatus === "saving" ? "正在保存引導進度…" : guidedSaveStatus === "error" ? "進度保存連線中斷，稍後會再嘗試" : draftSavedAt ? `已保存｜${draftSavedAt}` : "引導進度會自動保存"}
                    </small>
                  </div>
                </header>

                <div className="essay-chat-column">
                    {coachStarted && <div className="essay-chat-session-status" aria-live="polite">
                      <span>本次練習 {Math.min(coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length, coachRoundLimit)}／{coachRoundLimit} 輪</span>
                      <small>{coachOffTopicCount ? `離題 ${coachOffTopicCount}／3 次` : coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length === coachRoundLimit - 1 ? "剩最後 1 輪；完成後將整理成果並關閉對話" : `達到 ${coachRoundLimit} 輪後將整理成果並關閉對話`}</small>
                    </div>}
                    <div ref={coachMessagesRef} className="essay-chat-messages" aria-live="polite">
                      {!coachStarted && <div className="essay-chat-empty"><span className="mentor-avatar">律</span><div><strong>準備好了嗎？</strong><p>{accountCanAdmin ? "請在下方選好學生程度與回答模型，再按「開始對話」；之後會依這一題的科目自然追問，不會套用其他法科的流程。" : "按「開始對話」後，AI 導師會依這一題的科目自然追問，不會套用其他法科的流程。"}</p></div></div>}
                      {coachMessages.map((message, index) => !accountCanAdmin && message.role === "scholar" ? null : <div className={`essay-chat-message ${message.role}`} key={`${message.role}-${index}`}>
                        {message.role !== "student" && <span className={`mentor-avatar ${message.role === "scholar" ? "scholar-avatar" : ""}`}>{message.role === "scholar" ? coachTeachingLevelShortLabels[coachTeachingLevel] : "律"}</span>}
                        <div className="essay-chat-message-content">
                          <div className="essay-chat-bubble">
                            <b>{message.role === "mentor" ? "AI 導師" : message.role === "scholar" ? `AI ${coachTeachingLevelLabels[coachTeachingLevel]}` : "我"}</b>
                            <p>{message.text}</p>
                            {message.role === "mentor" && message.text.includes("【單題批改：通過】") && question?.teacherAnswer && <details className="essay-full-analysis"><summary>查看完整解析</summary><p>{question.teacherAnswer}</p></details>}
                            {accountCanAdmin && message.role === "mentor" && <label className={`essay-message-reply ${selectedCoachMessageIndex === index ? "is-selected" : ""}`}>
                              <input
                                type="checkbox"
                                checked={selectedCoachMessageIndex === index}
                                onChange={() => setSelectedCoachMessageIndex((current) => current === index ? null : index)}
                                disabled={coaching}
                              />
                              <span>回覆此訊息</span>
                            </label>}
                          </div>
                        </div>
                      </div>)}
                      {coaching && <div className={`essay-chat-message ${coachTypingRole}`}><span className={`mentor-avatar ${coachTypingRole === "scholar" ? "scholar-avatar" : ""}`}>{coachTypingRole === "scholar" ? coachTeachingLevelShortLabels[coachTeachingLevel] : "律"}</span><div className="essay-chat-bubble typing"><i /><i /><i /></div></div>}
                    </div>
                    <div className="essay-chat-composer-wrap">
                      {accountCanAdmin && <div className={`essay-chat-settings model-mode-switch ${coachSettingsOpen ? "" : "is-collapsed"}`} aria-label="管理測試設定">
                        <div className="model-mode-heading">
                          <strong>管理測試設定</strong>
                          <span className="model-mode-summary">{coachTeachingLevel === "general" ? "一般學生" : coachTeachingLevel === "beginner" ? "法律小白" : coachTeachingLevel === "intermediate" ? "基礎考生" : coachTeachingLevel === "advanced" ? "進階考生" : "頂尖學霸"} · Luna</span>
                          <button type="button" className="model-settings-toggle" aria-expanded={coachSettingsOpen} onClick={() => setCoachSettingsOpen((open) => !open)}>{coachSettingsOpen ? "收合設定" : "展開設定"}</button>
                        </div>
                        {coachSettingsOpen && <>
                        <div className="model-mode-fields">
                          <label><span>模擬程度</span><select value={coachTeachingLevel} disabled={coachSettingsPinned || coaching} onChange={(event) => { const value = event.target.value as CoachTeachingLevel; setCoachTeachingLevel(value); persistCoachSetting(value, coachModelMode); }}><option value="general">一般學生</option><option value="beginner">法律小白</option><option value="intermediate">基礎考生</option><option value="advanced">進階考生</option><option value="super">頂尖學霸</option></select></label>
                          <label><span>回答</span><select value="luna" disabled><option value="luna">Luna</option></select></label>
                        </div>
                        <div className={`model-settings-pin-row ${coachSettingsPinned ? "is-pinned" : ""}`}><label className="model-settings-pin"><input type="checkbox" checked={coachSettingsPinned} onChange={(event) => toggleCoachSettingsPinned(event.target.checked)} disabled={coaching} /><span>記住學生角色</span></label><small>Luna 為固定模型；此設定只記住學生角色。</small></div>
                        </>}
                      </div>}
                      <div className="essay-chat-composer-actions">
                        {!coachStarted ? <><span>{accountCanAdmin ? "設定完成後，開始這一題的自然對話" : "準備好後，開始這一題的自然對話"}</span><button type="button" className="essay-chat-start scholar-start-button" onClick={startEssayCoach} disabled={coaching}>開始對話</button></> : coachEnded ? <div className="essay-chat-finish-panel"><div><strong>本次引導已完成</strong><span>老師已完成收尾，請選擇下一步。</span></div><div><button type="button" onClick={startEssayCoach}>再練一次</button><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>回到題目</button><button type="button" className="primary" onClick={() => setEssayUnlocked(true)}>進入考場擬答</button></div></div> : <><span>{coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length === coachRoundLimit - 1 ? "剩最後 1 輪" : "你可以直接回答，或使用下方引導"}</span>{coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length >= 7 && !coachExtended && <button type="button" className="essay-extend-button" onClick={extendCoachConversation} disabled={coaching}>延長 2 輪</button>}<button type="button" className="essay-end-summary-button" onClick={() => void askCoach("end_summary")} disabled={coaching}>請老師總結並結束</button></>}
                      </div>
                      {coachStarted && !coachEnded && <div className="essay-chat-guidance-actions" aria-label="回答引導">
                        <button type="button" onClick={() => sendGuidedCoachReply("hint")} disabled={coaching}>給我一點提示</button>
                        <button type="button" onClick={() => sendGuidedCoachReply("smaller_step")} disabled={coaching}>拆成更小一步</button>
                        {accountCanAdmin && <button type="button" className="student-simulation" onClick={() => void generateScholarFollowUp()} disabled={coaching}>{selectedCoachMessageIndex === null ? "模擬學生回答" : "模擬學生回答這句"}</button>}
                      </div>}
                      <form className="essay-chat-composer" onSubmit={(event) => { event.preventDefault(); void askCoach(); }}><textarea ref={coachComposerInputRef} value={coachInput} onChange={(event) => setCoachInput(event.target.value)} placeholder={coachEnded ? "本次對話已結束" : coachStarted ? "回答 AI 導師的問題……" : "開始對話後，這裡會成為你的回答框……"} rows={1} disabled={coaching || !coachStarted || coachEnded || coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length >= coachRoundLimit} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askCoach(); } }} /><button type="submit" aria-label="送出回答" disabled={coaching || !coachStarted || coachEnded || coachMessages.filter((message) => message.role === "student" || (accountCanAdmin && message.role === "scholar")).length >= coachRoundLimit || !coachInput.trim()}>↑</button></form>
                    </div>
                </div>
                {(coachIssue || coachGap) && <div className="practice-diagnosis essay-chat-diagnosis">{coachIssue && <p><b>目前爭點</b>{coachIssue}</p>}{coachGap && <p><b>需要加強</b>{coachGap}</p>}</div>}
                {coachComparisons.length > 1 && <div className="essay-coach-comparisons"><b>AI 模型測試比較</b><div>{coachComparisons.map((item) => <article key={`${item.label}-${item.model}`}><strong>{item.label}</strong><small>{item.model}</small><p>{item.text}</p><em>{item.inputTokens + item.outputTokens} tokens · US$ {item.estimatedCostUsd.toFixed(5)}</em></article>)}</div></div>}
              </section>
              {coachProgress.readyForEssay && !essayUnlocked && <section className="guided-answer-choice" aria-label="理解驗收完成">
                <header><span>理解驗收完成</span><strong>下一步由你決定，不會自動跳入擬答</strong></header>
                <p>你已完成事實辨識、爭點、判準、涵攝、結論與微型變化題。可以再練、先整理，或自行開始模考擬答。</p>
                <div>
                  <button type="button" onClick={() => void askCoach("coach", { role: "student", text: "我想再練一輪，請針對我最薄弱的地方再出一個短問題。" })} disabled={coaching}>再練一輪</button>
                  <button type="button" onClick={() => void askCoach("coach", { role: "student", text: "請只整理目前已完成的解題架構，不要進入完整擬答；整理後再問我是否要作答。" })} disabled={coaching}>整理解題架構</button>
                  <button type="button" className="primary" onClick={() => setEssayUnlocked(true)}>模考擬答</button>
                </div>
              </section>}
              {essayUnlocked ? <section
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
              </section> : !coachProgress.readyForEssay ? <section className="guided-answer-locked" aria-label="正式作答尚未解鎖"><strong>先完成理解與微型變化題，再選擇是否進入擬答</strong><p>AI 會逐步帶你完成事實、爭點、判準、涵攝與結論；多位行為人及多個爭點都須逐項處理。</p></section> : null}
              {essayUnlocked && <>
              {essayModelPicker()}
              <button
                className="essay-submit-wide"
                disabled={!coachProgress.readyForEssay || !essay.trim() || submitting || !question.hasTeacherAnswer}
                onClick={() => void submitEssay()}
              >
                {submitting ? "批改中…" : essayGrading ? "重新批改" : "送出批改"}
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
