"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ListeningPlayer, ListeningFeed } from "../listening-player";
import CourseVideoPlayer, { formatMediaTime, PlaybackRateSelect } from "../course-video-player";
import { PracticeLab } from "./practice-lab";
import { IssuePractice } from "./issue-practice";
import { LegalResearchTabs } from "./legal-research-tabs";
import { taipeiDate, taipeiMonth } from "../../lib/taipei-time";
import { formatTwd } from "../../lib/currency";
import { useSimulationToolsEnabled } from "../../lib/use-simulation-tools";
import { coreExamPoints } from "../../lib/core-exam-points";
import type { YoutubePlaylistItem } from "../../lib/youtube-playlist";

type Plan = {
  id: number;
  title: string;
  targetLabel: string;
  dailyMinutes: number;
};
type Task = {
  id: number;
  planId: number;
  taskDate: string;
  subject: string;
  title: string;
  durationMinutes: number;
  details: string;
  status: string;
};
type Draft = {
  id?: number;
  date: string;
  subject: string;
  title: string;
  durationMinutes: number;
  details: string;
  status: string;
};
type StudyRecord = {
  id: number;
  recordDate: string;
  subject: string;
  title: string;
  activityType: string;
  plannedMinutes: number;
  actualMinutes: number;
  correct: boolean | null;
  reflection: string;
  weakness: string;
  nextStep: string;
};
type LearningAnalysisRecommendation = {
  title: string;
  type: string;
  reason: string;
  action: string;
  resourceId: number | null;
  segmentId: number | null;
  url: string;
  location: string;
};
type LearningAnalysis = {
  statusLabel: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  nextAction: string;
  recommendations: LearningAnalysisRecommendation[];
  model: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  generatedAt?: string;
  saved?: boolean;
  isStale?: boolean;
};
type SavedNote = {
  id: number;
  sourceType?: string;
  sourceId?: string | null;
  title: string;
  content: string;
  subject: string;
  tags: string;
  sourceLabel: string;
  updatedAt: string;
  attachments?: Array<{
    id: number;
    kind: string;
    contentType: string;
    sizeBytes: number;
    sourceUrl: string;
    episodeTitle: string;
    positionSeconds: number;
    url: string;
  }>;
};
type StudentSummary = {
  id: number;
  name: string;
  displayTitle?: string;
  subject: string;
  topic?: string;
  collectionTitle?: string;
  folder?: string;
  sizeBytes: number;
  status: string;
  processingStage: string;
  processingMessage: string;
  error?: string | null;
  createdAt: string | Date;
  summary: string;
  editedSummary: string;
  favorite: boolean;
  examFocus: string;
  keyPoints: string[];
  issueOutline: string[];
  commonMistakes: string[];
  sourceNotes: string[];
  tags: string[];
  flashcards: Array<{ question: string; answer: string }>;
  model: string;
  fontSize?: number;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsd: number } | null;
};
type SummaryFolder = { subject: string; name: string };
const summaryFieldOptions = [
  { key: "summary", label: "摘要", fields: ["summary"] },
  { key: "focus", label: "考點與爭點", fields: ["examFocus", "keyPoints", "issueOutline"] },
  { key: "mistakes", label: "常見錯誤", fields: ["commonMistakes"] },
  { key: "sources", label: "來源依據", fields: ["sourceNotes"] },
] as const;
const defaultSummaryFields = summaryFieldOptions.flatMap((option) => [...option.fields]);
type LearningResource = {
  id: number;
  resourceType: "book" | "course" | "trial" | "magazine";
  title: string;
  subject: string;
  creator: string;
  description: string;
  documentId: number | null;
  documentStatus?: string | null;
  documentError?: string | null;
  documentChapterCount?: number;
  documentTopicCount?: number;
  documentQuestionCount?: number;
  sourceUrl: string;
  accessType: string;
  courseCategory?: "managed" | "public" | null;
  status: string;
  sortOrder: number;
  segmentCount: number;
  hasCover?: number;
};
type CourseCollection = {
  id: number;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  courses: Array<LearningResource & { itemId: number; itemSortOrder: number }>;
};
type MyCourse = {
  id: number;
  userKey: string;
  title: string;
  sourceUrl: string;
  sourceKind: "playlist" | "video" | string;
  playlistId: string | null;
  videoId: string | null;
  subject: string;
  examType: string;
  scope: string;
  relevanceLabel: string;
  relevanceScore: number;
  metadata?: { itemCount?: number; firstVideoTitle?: string; judgementReason?: string };
  createdAt: string;
};
type ResourceSegment = {
  id: number;
  resourceId: number;
  segmentType: string;
  lessonLabel: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  summary: string;
  importance: number;
  recommended: boolean;
  sequence: number;
  completeQuestion?: boolean;
};

function studentProblemQuestion(value: string, title = "") {
  let text = value
    .replace(/\u0000/g, "")
    .replace(/[\uE000-\uF8FF□■▪▫◆◇●○★☆▸◂▶◀]+\s*(爭\s*點\s*解\s*析)\s*[\uE000-\uF8FF□■▪▫◆◇●○★☆▸◂▶◀]*/gu, "$1")
    .replace(/爭\s*點\s*解\s*析/gu, "爭點解析")
    .trim();
  const structured = text.match(/^【完整題目】\s*([\s\S]*?)(?:\s*\n\s*【(?:爭點解析|擬答)】|$)/u);
  if (structured) text = structured[1].trim();
  else {
    const boundary = /(?:【\s*)?爭點解析(?:\s*】)?\s*[:：]?|(?:【\s*)?擬\s*答(?:\s*】)?\s*[:：]/u.exec(text);
    if (boundary) text = text.slice(0, boundary.index).trim();
  }
  const escapedTitle = title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedTitle) text = text.replace(new RegExp(`^(?:題型\\s*[\\d.．、-]+\\s*)?${escapedTitle}\\s*`, "u"), "").trim();
  return text;
}

function teacherProblemAnswer(value: string) {
  const text = value.replace(/\u0000/g, "").replace(/爭\s*點\s*解\s*析/gu, "爭點解析").trim();
  const structured = text.match(/^【完整題目】\s*[\s\S]*?\s*\n\s*【(?:爭點解析|擬答)】\s*([\s\S]+)$/u);
  if (structured?.[1]) return structured[1].trim();
  const boundary = /(?:【\s*)?爭點解析(?:\s*】)?\s*[:：]?|(?:【\s*)?擬\s*答(?:\s*】)?\s*[:：]/u.exec(text);
  return boundary ? text.slice((boundary.index ?? 0) + boundary[0].length).trim() : "";
}

function studentProblemParagraphs(value: string, title = "") {
  const question = studentProblemQuestion(value, title)
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!question) return [];

  return question
    .split(/\n\s*\n+/u)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("")
        .replace(/[ \t\u3000]+/gu, " ")
        .trim(),
    )
    .filter(Boolean);
}
type BookFullTextHit = {
  section: string;
  excerpt: string;
  page_start: number | null;
  page_end: number | null;
  relevance: string;
};
type TeachingEvidence = {
  status: "verified" | "applied_inference" | "full_text_search" | "unavailable";
  retrieval: "chapter_segment" | "stored_analysis" | "full_text_search" | "none";
  resourceId: number;
  segmentId: number;
  resourceTitle: string;
  segmentTitle: string;
  lessonLabel: string;
  pageStart: number | null;
  pageEnd: number | null;
  fileName: string;
  excerpt: string;
  message: string;
  matchedTerms?: string[];
  basis?: "teacher_solution" | "chapter";
};
type BookUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number };
type ChallengeRun = { reply: string; model: string; usage: BookUsage };
type BookModelMode = "luna" | "sonnet" | "deepseek" | "compare-luna-sonnet" | "compare-luna-deepseek" | "compare-sonnet-deepseek" | "compare-luna-sonnet-deepseek";
type BookComparison = {
  responses: Array<{
    id: number;
    label: string;
    model: string;
    text: string;
    error?: string | null;
    usage: { inputTokens: number; cachedTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number };
  }>;
};
type BookHistoryEntry = {
  id: number;
  resourceId: number | null;
  segmentId: number | null;
  title: string;
  summary: string;
  updatedAt: string | Date;
  progressStatus?: string;
  messageCount: number;
  lastRole: string | null;
  lastText: string;
};
type TutorMessage = { role: "mentor" | "student" | "scholar"; text: string; model?: string; usage?: BookUsage; comparison?: BookComparison; teachingEvidence?: TeachingEvidence | null; createdAt?: string | Date };

async function fetchBookConversation(input: string, init: RequestInit, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
type ChatDay = {
  id: number;
  date: string;
  title: string;
  summary: string;
  progressStatus: string;
  messageCount: number;
  messages: Array<{
    role: "mentor" | "student";
    text: string;
    sources?: string[];
  }>;
};
type ExamCoachConversation = {
  questionId: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  messages: Array<{
    id: number;
    role: string;
    text: string;
    createdAt: string;
  }>;
};
type MagazineFeed = {
  id: number;
  title: string;
  sourceUrl: string;
  description?: string;
  isDraft?: boolean;
  articles?: Array<{
    id: number;
    title: string;
    summary: string;
    issue: string;
    sourceUrl: string;
    reviewStatus: string;
    sequence: number;
  }>;
  catalog?: Array<{
    id: number;
    title: string;
    sourceUrl: string;
    category: string;
    author: string;
    content: string;
    sequence: number;
  }>;
};
type HomeFeed = {
  magazines?: MagazineFeed[];
  magazine: MagazineFeed | null;
  listeningItems?: ListeningFeed[];
  listening: ListeningFeed | null;
  focusMusicUrl?: string;
};

const subjects = [
  "刑法",
  "刑事訴訟法",
  "民法",
  "民事訴訟法",
  "憲法",
  "行政法",
  "商事法",
  "綜合",
];

const planningSubjects = [
  "刑法",
  "刑事訴訟法",
  "民法",
  "民事訴訟法",
  "憲法",
  "行政法",
  "商事法",
];
const subjectScopes: Record<string, string[]> = {
  刑法: ["全科", "刑法總則", "刑法分則"],
  刑事訴訟法: ["全科", "偵查", "強制處分", "證據", "審判", "救濟"],
  民法: ["全科", "民法總則", "債法", "物權", "親屬", "繼承"],
  民事訴訟法: ["全科", "總則", "第一審", "證據", "上訴與抗告", "強制執行"],
  憲法: ["全科", "基本權", "權力分立", "憲法訴訟"],
  行政法: ["全科", "行政處分", "行政程序", "行政救濟", "國家責任"],
  商事法: ["全科", "公司法", "證券交易法", "保險法", "票據法"],
};
const planningGoals = [
  "建立體系",
  "學習爭點",
  "一試刷題",
  "二試申論",
  "考前複習",
];
const planningResources = ["教材", "影音", "法條", "真題", "申論", "錯題複習"];
type ResetPlanDraft = {
  mode: "all" | "single";
  subject: string;
  scope: string;
  level: "初學" | "有基礎" | "進階";
  dailyMinutes: number;
  days: number;
  goals: string[];
  resources: string[];
  priorityMode: "adaptive" | "core-first";
  clearScope: "all" | "subject";
  step: "settings" | "preview";
};

function coachPreview(records: StudyRecord[]): LearningAnalysis {
  const answered = records.filter((record) => record.correct !== null);
  const correct = answered.filter((record) => record.correct).length;
  const minutes = records.reduce((sum, record) => sum + record.actualMinutes, 0);
  const accuracy = answered.length ? Math.round((correct / answered.length) * 100) : null;
  const weaknessCounts = new Map<string, number>();
  records.forEach((record) => {
    const weakness = record.weakness.trim();
    if (weakness) weaknessCounts.set(weakness, (weaknessCounts.get(weakness) ?? 0) + 1);
  });
  const weaknesses = [...weaknessCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const primary = weaknesses[0]?.[0] ?? (accuracy !== null && accuracy < 70 ? "選項判斷與錯因整理" : "尚未形成穩定弱點樣本");
  return {
    statusLabel: !records.length ? "尚在建立學習樣本" : accuracy !== null && accuracy < 70 ? "需要先補核心觀念" : accuracy !== null && accuracy >= 80 ? "基礎穩定，應增加涵攝與變化題" : "正在累積，下一步要加強回想",
    summary: !records.length ? "先完成幾次學習與作答，AI 教練才有足夠資料辨認你的穩定弱點。" : `最近累積 ${minutes} 分鐘學習${accuracy === null ? "，目前以閱讀與對話為主" : `，作答正確率 ${accuracy}%`}。目前最值得先處理的是「${primary}」。`,
    strengths: records.length ? ["已留下可追蹤的學習紀錄", minutes >= 120 ? "投入時間已形成穩定節奏" : "已開始累積學習節奏"] : ["已進入學習專區", "接下來可用紀錄讓教練更精準"],
    gaps: weaknesses.length ? weaknesses.map(([topic, count]) => `${topic}（${count} 次）`) : ["尚未有足夠的弱點紀錄", answered.length ? "需要持續記下每題錯因" : "需要增加作答樣本"],
    nextAction: "點擊「開始分析」，讓 AI 教練依完整紀錄安排下一個補強動作。",
    recommendations: [],
    model: "尚未分析",
  };
}

function monthValue(date = new Date()) {
  return taipeiMonth(date);
}

type PlanTab =
  | "calendar"
  | "practice"
  | "hotspots"
  | "summaries"
  | "laws"
  | "books"
  | "courses"
  | "public-courses"
  | "my-courses"
  | "listening"
  | "magazine"
  | "records"
  | "conversations"
  | "exam-conversations"
  | "notes";

function requestedPlanTab(): PlanTab {
  if (typeof window === "undefined") return "calendar";
  const value = new URLSearchParams(window.location.search).get("tab");
  if (value === "essay-history") return "practice";
  return [
    "calendar",
    "practice",
    "hotspots",
    "summaries",
    "laws",
    "books",
    "courses",
    "public-courses",
    "my-courses",
    "listening",
    "magazine",
    "records",
    "conversations",
    "exam-conversations",
    "notes",
  ].includes(value ?? "")
    ? (value as PlanTab)
    : "calendar";
}

function courseEpisodeContextId(videoId: string | null | undefined) {
  if (!videoId) return 0;
  let hash = 0;
  for (const character of videoId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}

function magazineYear(magazine: MagazineFeed) {
  const text = `${magazine.title} ${magazine.description ?? ""}`;
  const western = text.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1];
  if (western) return western;
  const roc = text.match(/(?:民國\s*)?(1\d{2})\s*年/)?.[1];
  return roc ? String(Number(roc) + 1911) : "年份未標示";
}

function magazineIssueLabel(title: string) {
  return title.match(/第\s*\d+\s*期/)?.[0].replace(/\s+/g, "") ?? title;
}

function magazineIssueNumber(magazine: MagazineFeed) {
  return Number(
    `${magazine.title} ${magazine.description ?? ""}`.match(
      /第\s*(\d+)\s*期/,
    )?.[1] ?? 0,
  );
}

function highlightMagazineText(text: string, query: string): ReactNode {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!terms.length || !text) return text;
  const escaped = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const matcher = new RegExp(`(${escaped.join("|")})`, "giu");
  return text.split(matcher).map((part, index) =>
    terms.some(
      (term) =>
        part.toLocaleLowerCase("zh-Hant") === term.toLocaleLowerCase("zh-Hant"),
    ) ? (
      <mark className="magazine-search-highlight" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function isProblemSolvingBook(
  resource: Pick<LearningResource, "title" | "description"> | null | undefined,
) {
  return Boolean(
    resource &&
    /解題|題庫|題型|案例演習|申論/.test(
      `${resource.title} ${resource.description}`,
    ),
  );
}

const bookTeachingLevelLabels: Record<"general" | "beginner" | "intermediate" | "advanced" | "super", string> = {
  general: "自由提問",
  beginner: "法律小白",
  intermediate: "基礎考生",
  advanced: "進階考生",
  super: "頂尖學霸",
};

function problemBookOutline(chapters: ResourceSegment[]) {
  const outlineOrder = (label: string, kind: "section" | "topic") => {
    const normalized = label.trim();
    if (/未分類|待核對|其他/.test(normalized)) return Number.MAX_SAFE_INTEGER;
    const pattern = kind === "section"
      ? /(?:第\s*)?(\d+)\s*(?:部|部分)/
      : /主題\s*(\d+)/;
    const matched = normalized.match(pattern);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER - 1;
  };
  const compareOutlineLabels = (kind: "section" | "topic") =>
    ([left]: [string, unknown], [right]: [string, unknown]) =>
      outlineOrder(left, kind) - outlineOrder(right, kind)
      || left.localeCompare(right, "zh-Hant", { numeric: true });
  const sections = new Map<string, Map<string, ResourceSegment[]>>();
  for (const chapter of chapters) {
    const [rawSection, rawTopic] = chapter.lessonLabel.split("｜");
    const section =
      rawSection?.trim() && rawSection !== "教材章節"
        ? rawSection.trim()
        : "題型目錄";
    const topic = rawTopic?.trim() || "其他題型";
    if (!sections.has(section)) sections.set(section, new Map());
    const topics = sections.get(section)!;
    topics.set(topic, [...(topics.get(topic) ?? []), chapter]);
  }
  return [...sections]
    .sort(compareOutlineLabels("section"))
    .map(([section, topics]) => ({
    section,
    topics: [...topics]
      .sort(compareOutlineLabels("topic"))
      .map(([topic, questions]) => ({
        topic,
        questions: [...questions].sort(
          (left, right) => left.sequence - right.sequence || left.id - right.id,
        ),
      })),
  }));
}

type StudyPlanPageProps = {
  initialTab?: PlanTab;
  standalone?: boolean;
};

type CurrentMember = { canAdmin: boolean };

export default function StudyPlanPage({ initialTab = "calendar", standalone = false }: StudyPlanPageProps = {}) {
  const simulationToolsEnabled = useSimulationToolsEnabled();
  const [currentMember, setCurrentMember] = useState<CurrentMember | null>(null);
  const [month, setMonth] = useState(monthValue());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(taipeiDate());
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch("/api/account")
      .then(async (response) => response.ok ? (await response.json()).member as CurrentMember : null)
      .then(setCurrentMember)
      .catch(() => setCurrentMember(null));
  }, []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [expandedRecordIds, setExpandedRecordIds] = useState<Set<number>>(new Set());
  const [chatDays, setChatDays] = useState<ChatDay[]>([]);
  const [examConversations, setExamConversations] = useState<
    ExamCoachConversation[]
  >([]);
  const [openExamConversation, setOpenExamConversation] = useState<
    number | null
  >(null);
  const [openChatDay, setOpenChatDay] = useState<number | null>(null);
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(new Set());
  const [deletingRecords, setDeletingRecords] = useState(false);
  const [learningAnalysis, setLearningAnalysis] = useState<LearningAnalysis | null>(null);
  const [learningAnalysisLoading, setLearningAnalysisLoading] = useState(false);
  const [learningAnalysisNotice, setLearningAnalysisNotice] = useState("");
  const [showAnalysisCost, setShowAnalysisCost] = useState(false);
  const [notePage, setNotePage] = useState(1);
  const [noteQuery, setNoteQuery] = useState("");
  const [recordDraft, setRecordDraft] = useState({
    subject: "刑法",
    title: "",
    actualMinutes: 60,
    weakness: "",
    nextStep: "",
  });
  const [activeTab, setActiveTab] = useState<PlanTab>(initialTab);
  const [studentSummaries, setStudentSummaries] = useState<StudentSummary[]>([]);
  const [selectedSummaryId, setSelectedSummaryId] = useState<number | null>(null);
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<Set<number>>(new Set());
  const [summaryFields, setSummaryFields] = useState<string[]>(defaultSummaryFields);
  const [summaryCustomFields, setSummaryCustomFields] = useState<string[]>([]);
  const [summaryCustomDraft, setSummaryCustomDraft] = useState("");
  const [summarySubject, setSummarySubject] = useState("刑法");
  const [summaryTopic, setSummaryTopic] = useState("");
  const [summaryUploadLoading, setSummaryUploadLoading] = useState(false);
  const [summaryNotice, setSummaryNotice] = useState("");
  const [summarySaving, setSummarySaving] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryFavorite, setSummaryFavorite] = useState(false);
  const [summarySelectedFile, setSummarySelectedFile] = useState<File | null>(null);
  const [summaryPane, setSummaryPane] = useState<"summary" | "files">("summary");
  const [summaryDeleting, setSummaryDeleting] = useState(false);
  const [summaryTitleDraft, setSummaryTitleDraft] = useState("");
  const [summaryFontSize, setSummaryFontSize] = useState(20);
  const [summaryFolders, setSummaryFolders] = useState<SummaryFolder[]>([]);
  const [summaryFolderDraft, setSummaryFolderDraft] = useState("");
  const [editingSummaryFolder, setEditingSummaryFolder] = useState<string | null>(null);
  const [editingSummaryFolderName, setEditingSummaryFolderName] = useState("");
  const [summaryFolderSubject, setSummaryFolderSubject] = useState("刑法");
  const [summaryDestination, setSummaryDestination] = useState("");
  const [summaryCollectionTitle, setSummaryCollectionTitle] = useState("");
  const [hotSubject, setHotSubject] = useState("全部");
  const [publicCourseSubject, setPublicCourseSubject] = useState("全部");
  const [selectedPublicCourseId, setSelectedPublicCourseId] = useState<number | null>(null);
  const [pendingBookPoint, setPendingBookPoint] = useState<{
    title: string;
    summary: string;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState<SavedNote | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [courseCollections, setCourseCollections] = useState<CourseCollection[]>([]);
  const [courseCollectionsLoaded, setCourseCollectionsLoaded] = useState(false);
  const [playlistItemsByCourse, setPlaylistItemsByCourse] = useState<Record<number, YoutubePlaylistItem[]>>({});
  const [playlistMessages, setPlaylistMessages] = useState<Record<number, string>>({});
  const [selectedPublicEpisodeId, setSelectedPublicEpisodeId] = useState<string | null>(null);
  const playlistFetchesRef = useRef<Set<number>>(new Set());
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);
  const [myCourseUrl, setMyCourseUrl] = useState("");
  const [myCourseTitle, setMyCourseTitle] = useState("");
  const [myCourseSubject, setMyCourseSubject] = useState("刑法");
  const [myCourseExamType, setMyCourseExamType] = useState("一試／二試");
  const [myCourseScope, setMyCourseScope] = useState("全科");
  const [myCourseLoading, setMyCourseLoading] = useState(false);
  const [myCourseMessage, setMyCourseMessage] = useState("");
  const [myCourseJudgement, setMyCourseJudgement] = useState<{ label: string; score: number; reason: string } | null>(null);
  const [selectedMyCourseId, setSelectedMyCourseId] = useState<number | null>(null);
  const [myCoursePlaylistItems, setMyCoursePlaylistItems] = useState<Record<number, YoutubePlaylistItem[]>>({});
  const [myCoursePlaylistMessages, setMyCoursePlaylistMessages] = useState<Record<number, string>>({});
  const [selectedMyEpisodeId, setSelectedMyEpisodeId] = useState<string | null>(null);
  const [myCourseListCollapsed, setMyCourseListCollapsed] = useState(false);
  const [myCoursePlaylistCollapsed, setMyCoursePlaylistCollapsed] = useState(false);
  const [publicPlaylistCollapsed, setPublicPlaylistCollapsed] = useState(false);
  const [myCourseAiInput, setMyCourseAiInput] = useState("");
  const [myCourseChatMessages, setMyCourseChatMessages] = useState<TutorMessage[]>([]);
  const [myCourseSessionId, setMyCourseSessionId] = useState<number | null>(null);
  const [myCourseLastQuestion, setMyCourseLastQuestion] = useState("");
  const [myCourseAiReply, setMyCourseAiReply] = useState("");
  const [myCourseAiLoading, setMyCourseAiLoading] = useState(false);
  const [myCourseAiNotice, setMyCourseAiNotice] = useState("");
  const [myCourseScreenshotDataUrl, setMyCourseScreenshotDataUrl] = useState("");
  const [myCourseScreenshotName, setMyCourseScreenshotName] = useState("");
  const [myCourseNoteMessage, setMyCourseNoteMessage] = useState("");
  const [publicCourseAiInput, setPublicCourseAiInput] = useState("");
  const [publicCourseChatMessages, setPublicCourseChatMessages] = useState<TutorMessage[]>([]);
  const [publicCourseSessionId, setPublicCourseSessionId] = useState<number | null>(null);
  const [publicCourseLastQuestion, setPublicCourseLastQuestion] = useState("");
  const [publicCourseAiReply, setPublicCourseAiReply] = useState("");
  const [publicCourseAiLoading, setPublicCourseAiLoading] = useState(false);
  const [publicCourseAiNotice, setPublicCourseAiNotice] = useState("");
  const [publicCourseScreenshotDataUrl, setPublicCourseScreenshotDataUrl] = useState("");
  const [publicCourseScreenshotName, setPublicCourseScreenshotName] = useState("");
  const [publicCourseNoteMessage, setPublicCourseNoteMessage] = useState("");
  const myCoursePlaylistFetchesRef = useRef<Set<number>>(new Set());
  const [magazineQuery, setMagazineQuery] = useState("");
  const [magazineYearFilter, setMagazineYearFilter] = useState("全部年度");
  const [selectedMagazineId, setSelectedMagazineId] = useState<number | null>(
    null,
  );
  const [magazineSelectedText, setMagazineSelectedText] = useState("");
  const [magazineInput, setMagazineInput] = useState("");
  const [magazineMessages, setMagazineMessages] = useState<TutorMessage[]>([]);
  const [magazineSessionId, setMagazineSessionId] = useState<number | null>(
    null,
  );
  const [magazineAiLoading, setMagazineAiLoading] = useState(false);
  const [magazineAiNotice, setMagazineAiNotice] = useState("");
  const magazineInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(
    null,
  );
  const [expandedBookId, setExpandedBookId] = useState<number | null>(null);
  const [resourceSegments, setResourceSegments] = useState<ResourceSegment[]>(
    [],
  );
  const [bookChapters, setBookChapters] = useState<ResourceSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(
    null,
  );
  const [courseSeekToken, setCourseSeekToken] = useState(0);
  const [youtubePlaybackRate, setYoutubePlaybackRate] = useState(1);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(
    null,
  );
  const [bookMessages, setBookMessages] = useState<TutorMessage[]>([]);
  const [bookSessionId, setBookSessionId] = useState<number | null>(null);
  const [lastBookSessionId, setLastBookSessionId] = useState<number | null>(null);
  const [bookHistory, setBookHistory] = useState<BookHistoryEntry[]>([]);
  const [bookHistoryOpen, setBookHistoryOpen] = useState(false);
  const [bookHistoryLoading, setBookHistoryLoading] = useState(false);
  const [lastBookProgress, setLastBookProgress] = useState<{
    resourceId: number;
    segmentId: number;
  } | null>(null);
  const [bookInput, setBookInput] = useState("");
  const [bookChatLoading, setBookChatLoading] = useState(false);
  const [bookLoadingRole, setBookLoadingRole] = useState<"mentor" | "scholar" | null>(null);
  const [bookSelectedMessageIndex, setBookSelectedMessageIndex] = useState<number | null>(null);
  const [bookQuestionOpen, setBookQuestionOpen] = useState(true);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [bookFocusMode, setBookFocusMode] = useState(false);
  const [bookSettingsPinned, setBookSettingsPinned] = useState(false);
  const [bookModelMode, setBookModelMode] = useState<BookModelMode>("luna");
  const [bookTeachingLevel, setBookTeachingLevel] = useState<"beginner" | "intermediate" | "advanced" | "super" | null>(null);
  const [bookTestNotice, setBookTestNotice] = useState("");
  const [lawScholarReflectionEnabled, setLawScholarReflectionEnabled] = useState(true);
  const [challengeStudentAnswer, setChallengeStudentAnswer] = useState("");
  const [challengeAnswers, setChallengeAnswers] = useState<Partial<Record<"luna" | "sol", ChallengeRun>>>({});
  const [challengeVote, setChallengeVote] = useState<"luna" | "sol" | "both" | "neither" | "">("");
  const [challengeReason, setChallengeReason] = useState("");
  const [challengeCoach, setChallengeCoach] = useState<"terra" | "sonnet">("terra");
  const [challengeCoachRun, setChallengeCoachRun] = useState<ChallengeRun | null>(null);
  const [challengeReply, setChallengeReply] = useState<ChallengeRun | null>(null);
  const [challengeLoading, setChallengeLoading] = useState<"luna" | "sol" | "coach" | "reply" | null>(null);
  const [bookChaptersLoading, setBookChaptersLoading] = useState(false);
  const [bookChapterMessage, setBookChapterMessage] = useState("");
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [bookFullTextHits, setBookFullTextHits] = useState<BookFullTextHit[]>(
    [],
  );
  const [bookFullTextLoading, setBookFullTextLoading] = useState(false);
  const [bookFullTextMessage, setBookFullTextMessage] = useState("");
  const chapterBuildAttemptedRef = useRef<Set<number>>(new Set());
  const restoredBookProgressRef = useRef(false);
  const bookDialogueMessagesRef = useRef<HTMLDivElement | null>(null);
  const [resourceProgress, setResourceProgress] = useState<
    Record<
      string,
      {
        page: number;
        segmentId: number | null;
        positionSeconds: number;
        updatedAt: string;
      }
    >
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(
        window.localStorage.getItem("silu-resource-progress") ?? "{}",
      );
    } catch {
      return {};
    }
  });

  useEffect(() => {
    // Standalone learning routes provide their own tab explicitly. Only the
    // full learning-center page should restore a tab from the query string.
    if (!standalone) setActiveTab(requestedPlanTab());
  }, [standalone]);
  useEffect(() => {
    void fetch("/api/ai-access", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { plan?: { lawScholarReflectionEnabled?: boolean } };
      setLawScholarReflectionEnabled(data.plan?.lawScholarReflectionEnabled !== false);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    let localPreference: { pinned?: boolean; modelMode?: string; teachingLevel?: string | null } | null = null;
    try {
      const stored = window.localStorage.getItem("silu-book-ai-settings-pinned");
      if (stored) {
        const parsed = JSON.parse(stored) as { pinned?: boolean; modelMode?: string; teachingLevel?: string | null };
        localPreference = parsed;
        const allowedModes: BookModelMode[] = ["luna", "sonnet", "deepseek", "compare-luna-sonnet", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"];
        if (parsed.pinned) setBookSettingsPinned(true);
        if (allowedModes.includes(parsed.modelMode as BookModelMode)) setBookModelMode(parsed.modelMode as BookModelMode);
        if (["beginner", "intermediate", "advanced", "super"].includes(String(parsed.teachingLevel))) setBookTeachingLevel(parsed.teachingLevel as "beginner" | "intermediate" | "advanced" | "super");
      }
    } catch {
      window.localStorage.removeItem("silu-book-ai-settings-pinned");
    }
    fetch("/api/book-learning/preferences", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const { preference, stored } = await response.json() as { stored?: boolean; preference?: { bookTeachingLevel?: string | null; bookModelMode?: string; bookSettingsPinned?: boolean; lastBookResourceId?: number | null; lastBookSegmentId?: number | null; lastBookSessionId?: number | null } };
      if (!preference) return;
      if (!stored && localPreference) {
        void fetch("/api/book-learning/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookTeachingLevel: localPreference.teachingLevel ?? null, bookModelMode: localPreference.modelMode ?? "luna", bookSettingsPinned: Boolean(localPreference.pinned), lastBookResourceId: preference.lastBookResourceId ?? null, lastBookSegmentId: preference.lastBookSegmentId ?? null }) });
        return;
      }
      const allowedModes: BookModelMode[] = ["luna", "sonnet", "deepseek", "compare-luna-sonnet", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"];
      setBookSettingsPinned(Boolean(preference.bookSettingsPinned));
      if (allowedModes.includes(preference.bookModelMode as BookModelMode)) setBookModelMode(preference.bookModelMode as BookModelMode);
      setBookTeachingLevel(["beginner", "intermediate", "advanced", "super"].includes(String(preference.bookTeachingLevel)) ? preference.bookTeachingLevel as "beginner" | "intermediate" | "advanced" | "super" : null);
      if (preference.lastBookResourceId && preference.lastBookSegmentId) setLastBookProgress({ resourceId: preference.lastBookResourceId, segmentId: preference.lastBookSegmentId });
      if (preference.lastBookSessionId) setLastBookSessionId(preference.lastBookSessionId);
    }).catch(() => undefined);
  }, []);
  const [resourceMessage, setResourceMessage] = useState("");
  const [coursePlayerError, setCoursePlayerError] = useState("");
  const [courseCapture, setCourseCapture] = useState("");
  const [courseAiInput, setCourseAiInput] = useState("");
  const [courseAiReply, setCourseAiReply] = useState("");
  const [courseAiLoading, setCourseAiLoading] = useState(false);
  const [courseAiNotice, setCourseAiNotice] = useState("");
  const [courseAiAction, setCourseAiAction] = useState("");
  const [courseAiStage, setCourseAiStage] = useState(0);
  const [resetPlanOpen, setResetPlanOpen] = useState(false);
  const [resetPlanLoading, setResetPlanLoading] = useState(false);
  const [resetPlanMessage, setResetPlanMessage] = useState("");
  const [resetPlanDraft, setResetPlanDraft] = useState<ResetPlanDraft>({
    mode: "all",
    subject: "民法",
    scope: "全科",
    level: "有基礎",
    dailyMinutes: 120,
    days: 14,
    goals: ["建立體系", "一試刷題", "二試申論"],
    resources: ["教材", "影音", "法條", "真題", "申論", "錯題複習"],
    priorityMode: "adaptive",
    clearScope: "all",
    step: "settings",
  });

  async function load() {
    const response = await fetch(`/api/study-plan?month=${month}`);
    if (!response.ok) return;
    const result = (await response.json()) as { plans: Plan[]; tasks: Task[] };
    setPlans(result.plans ?? []);
    setTasks(result.tasks ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [month]);
  useEffect(() => {
    if (!lightboxImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxImage(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxImage]);
  useEffect(() => {
    fetch("/api/learning-records").then(async (response) => {
      if (response.ok)
        setRecords(
          ((await response.json()) as { records?: StudyRecord[] }).records ??
            [],
        );
    });
    fetch("/api/learning-analysis").then(async (response) => {
      if (!response.ok) return;
      const result = (await response.json()) as { analysis?: LearningAnalysis | null };
      if (result.analysis) setLearningAnalysis(result.analysis);
    }).catch(() => undefined);
    fetch("/api/usage").then(async (response) => {
      if (response.ok) setShowAnalysisCost(Boolean(((await response.json()) as { showCosts?: boolean }).showCosts));
    }).catch(() => undefined);
    fetch("/api/chat/history?archive=1").then(async (response) => {
      if (response.ok)
        setChatDays(
          ((await response.json()) as { archive?: ChatDay[] }).archive ?? [],
        );
    });
    fetch("/api/exam-coach-history").then(async (response) => {
      if (response.ok)
        setExamConversations(
          (
            (await response.json()) as {
              conversations?: ExamCoachConversation[];
            }
          ).conversations ?? [],
        );
    });
    fetch("/api/notes?category=law").then(async (response) => {
      if (response.ok)
        setNotes(
          ((await response.json()) as { notes?: SavedNote[] }).notes ?? [],
        );
    });
    fetch("/api/summaries").then(async (response) => {
      if (!response.ok) return;
      const summaries = ((await response.json()) as { summaries?: StudentSummary[] }).summaries ?? [];
      setStudentSummaries(summaries);
      const latest = summaries[0];
      if (latest) {
        setSelectedSummaryId(latest.id);
        setSummaryDraft(latest.editedSummary || latest.summary);
        setSummaryFavorite(latest.favorite);
        setSummaryTitleDraft(latest.displayTitle || latest.name);
        setSummaryTopic(latest.topic || "");
        setSummaryCollectionTitle(latest.collectionTitle || latest.topic || latest.displayTitle || "");
        setSummaryFontSize([16, 18, 20, 22, 24].includes(latest.fontSize ?? 20) ? latest.fontSize ?? 20 : 20);
      }
    }).catch(() => undefined);
    fetch("/api/summaries/folders").then(async (response) => {
      if (response.ok) setSummaryFolders(((await response.json()) as { folders?: SummaryFolder[] }).folders ?? []);
    }).catch(() => undefined);
    fetch("/api/summaries/preferences").then(async (response) => { if (!response.ok) return; const result = await response.json() as { preferences?: { fields?: string[]; customFields?: string[] } }; if (result.preferences?.fields) setSummaryFields(result.preferences.fields); if (result.preferences?.customFields) setSummaryCustomFields(result.preferences.customFields); }).catch(() => undefined);
    fetch("/api/home-feed").then(async (response) => {
      if (response.ok) setHomeFeed((await response.json()) as HomeFeed);
    });
    fetch("/api/resources").then(async (response) => {
      if (response.ok)
        setResources(
          ((await response.json()) as { resources?: LearningResource[] })
            .resources ?? [],
        );
    });
    fetch("/api/course-collections").then(async (response) => {
      if (response.ok) {
        setCourseCollections(
          ((await response.json()) as { collections?: CourseCollection[] }).collections ?? [],
        );
      }
      setCourseCollectionsLoaded(true);
    }).catch(() => setCourseCollectionsLoaded(true));
    fetch("/api/my-courses").then(async (response) => {
      if (response.ok) {
        const courses = ((await response.json()) as { courses?: MyCourse[] }).courses ?? [];
        setMyCourses(courses);
        if (courses[0]) setSelectedMyCourseId(courses[0].id);
      }
    }).catch(() => undefined);
    fetch("/api/book-learning").then(async (response) => {
      if (response.ok) {
        const result = (await response.json()) as {
          resourceId?: number | null;
          segmentId?: number | null;
          sessionId?: number | null;
        };
        if (result.resourceId && result.segmentId)
          setLastBookProgress({
            resourceId: result.resourceId,
            segmentId: result.segmentId,
          });
        if (result.sessionId) setLastBookSessionId(result.sessionId);
      }
    });
  }, []);

  useEffect(() => {
    if (activeTab !== "public-courses") return;
    const playlistCourses = courseCollections
      .flatMap((collection) => collection.courses)
      .filter((course) => isYoutubePlaylist(course.sourceUrl));
    playlistCourses.forEach((course) => {
      if (playlistFetchesRef.current.has(course.id)) return;
      playlistFetchesRef.current.add(course.id);
      const query = encodeURIComponent(course.sourceUrl);
      fetch(`/api/course-playlist?url=${query}`)
        .then(async (response) => {
          const result = (await response.json()) as { items?: YoutubePlaylistItem[]; error?: string };
          if (!response.ok) throw new Error(result.error ?? "播放清單暫時無法讀取");
          setPlaylistItemsByCourse((current) => ({ ...current, [course.id]: result.items ?? [] }));
        })
        .catch((error: unknown) => {
          setPlaylistMessages((current) => ({
            ...current,
            [course.id]: error instanceof Error ? error.message : "播放清單暫時無法讀取",
          }));
        });
    });
  }, [activeTab, courseCollections]);

  useEffect(() => {
    if (activeTab !== "my-courses") return;
    myCourses.filter((course) => course.sourceKind === "playlist" || Boolean(course.playlistId)).forEach((course) => {
      if (myCoursePlaylistFetchesRef.current.has(course.id)) return;
      myCoursePlaylistFetchesRef.current.add(course.id);
      fetch(`/api/course-playlist?url=${encodeURIComponent(course.sourceUrl)}`)
        .then(async (response) => {
          const result = (await response.json()) as { items?: YoutubePlaylistItem[]; error?: string };
          if (!response.ok) throw new Error(result.error ?? "播放清單暫時無法讀取");
          setMyCoursePlaylistItems((current) => ({ ...current, [course.id]: result.items ?? [] }));
        })
        .catch((error: unknown) => setMyCoursePlaylistMessages((current) => ({
          ...current,
          [course.id]: error instanceof Error ? error.message : "播放清單暫時無法讀取",
        })));
    });
  }, [activeTab, myCourses]);

  useEffect(() => {
    if (activeTab === "courses" && !courseCollectionsLoaded) return;
    const resource = resources.find((item) =>
      item.id === selectedResourceId &&
      (activeTab === "books"
        ? item.resourceType === "book"
        : item.resourceType === "course" && item.courseCategory !== "public"),
    ) ?? (activeTab === "courses"
      ? resources.find(
          (item) =>
            item.resourceType === "course" &&
            item.status !== "archived" &&
            item.courseCategory !== "public",
        )
      : null);
    if (
      !resource ||
      resource.resourceType !== "course" ||
      activeTab !== "courses"
    )
      return;
    fetch(
      `/api/resources/segments?resourceId=${resource.id}&view=summary`,
    ).then(async (response) => {
      if (response.ok)
        setResourceSegments(
          (
            ((await response.json()) as { segments?: ResourceSegment[] })
              .segments ?? []
          ).filter((segment) => segment.segmentType === "subtitle"),
        );
    });
  }, [resources, selectedResourceId, activeTab, courseCollectionsLoaded]);

  async function loadBookChapters(resourceId: number, allowBuild = true) {
    setBookChapters([]);
    setBookChapterMessage("");
    setBookChaptersLoading(true);
    try {
      const response = await fetch(
        `/api/resources/chapters?resourceId=${resourceId}`,
      );
      const result = (await response.json()) as {
        chapters?: ResourceSegment[];
        message?: string;
        error?: string;
        status?: string;
        ready?: boolean;
      };
      const chapters = result.chapters ?? [];
      setBookChapters(chapters);
      if (chapters.length) return;

      // The student page is the actual entry point for learning. If the PDF
      // index is ready but the one-time chapter list has not been created,
      // start that idempotent build here. The saved status prevents a page
      // refresh from creating another AI request.
      const canBuild =
        allowBuild &&
        result.ready &&
        (result.status === "not_started" || result.status === "failed");
      if (canBuild && !chapterBuildAttemptedRef.current.has(resourceId)) {
        chapterBuildAttemptedRef.current.add(resourceId);
        setBookChapterMessage("教材索引已完成，正在建立本書章節目錄…");
        const buildResponse = await fetch("/api/resources/chapters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resourceId }),
        });
        const buildResult = (await buildResponse.json()) as {
          chapters?: ResourceSegment[];
          error?: string;
          status?: string;
        };
        if (buildResult.chapters?.length) {
          setBookChapters(buildResult.chapters);
          setBookChapterMessage("");
        } else if (
          buildResponse.status === 202 ||
          buildResult.status === "building"
        ) {
          setBookChapterMessage("章節目錄正在建立，完成後會自動顯示…");
          window.setTimeout(() => {
            void loadBookChapters(resourceId, false);
          }, 2500);
        } else if (!buildResponse.ok) {
          setBookChapterMessage(
            buildResult.error ?? "章節目錄建立失敗，請再試一次。",
          );
        }
      } else if (result.status === "building") {
        setBookChapterMessage("章節目錄正在建立，完成後會自動顯示…");
        window.setTimeout(() => {
          void loadBookChapters(resourceId, false);
        }, 2500);
      } else if (!response.ok || !chapters.length) {
        setBookChapterMessage(
          result.message ?? result.error ?? "教材章節暫時無法讀取",
        );
      }
    } catch {
      setBookChapterMessage("教材章節暫時無法讀取，請再試一次。");
    } finally {
      setBookChaptersLoading(false);
    }
  }

  async function loadBookHistory(resourceId: number) {
    setBookHistoryLoading(true);
    try {
      const response = await fetch(`/api/book-learning?resourceId=${resourceId}`);
      const result = await response.json() as { history?: BookHistoryEntry[] };
      if (response.ok) setBookHistory(result.history ?? []);
    } catch {
      setBookHistory([]);
    } finally {
      setBookHistoryLoading(false);
    }
  }

  useEffect(() => {
    const resource =
      resources.find((item) => item.id === selectedResourceId) ??
      (activeTab === "books"
        ? resources.find(
            (item) =>
              item.resourceType === "book" && item.status !== "archived",
          )
        : null);
    if (!resource || resource.resourceType !== "book" || activeTab !== "books")
      return;
    setBookHistory([]);
    setBookHistoryOpen(false);
    const timer = window.setTimeout(() => {
      void loadBookChapters(resource.id);
      void loadBookHistory(resource.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [resources, selectedResourceId, activeTab]);

  useEffect(() => {
    if (activeTab !== "books") return;
    const messages = bookDialogueMessagesRef.current;
    if (!messages) return;
    // 只捲動訊息容器；不要使用 scrollIntoView，否則會連同整個頁面把
    // 下方的輸入框一起推到畫面外。
    const frame = window.requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, bookMessages, bookChatLoading, selectedChapterId]);

  const days = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const count = new Date(year, monthNumber, 0).getDate();
    const cells: Array<number | null> = Array(first.getDay()).fill(null);
    for (let day = 1; day <= count; day += 1) cells.push(day);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);

  function dateFor(day: number) {
    return `${month}-${String(day).padStart(2, "0")}`;
  }
  function openNew(day?: number) {
    setDraft({
      date: day ? dateFor(day) : `${month}-01`,
      subject: "刑法",
      title: "",
      durationMinutes: 60,
      details: "",
      status: "pending",
    });
  }
  function addCorePointTask(point: (typeof coreExamPoints)[number]) {
    setDraft({
      date: taipeiDate(),
      subject: point.subject,
      title: `熱考點｜${point.title}`,
      durationMinutes: 45,
      details: `${point.summary}\n\n作答提醒：${point.cue}`,
      status: "pending",
    });
  }
  function openCorePointBook(point: (typeof coreExamPoints)[number]) {
    const criminalBooks = bookResources.filter(
      (item) => item.subject === "刑法" || item.title.includes("刑法"),
    );
    const criminalBook =
      criminalBooks.find((item) => !isProblemSolvingBook(item)) ??
      criminalBooks[0];
    if (!criminalBook) return;
    setPendingBookPoint({ title: point.title, summary: point.summary });
    setSelectedResourceId(criminalBook.id);
    setExpandedBookId(criminalBook.id);
    setSelectedChapterId(null);
    setBookMessages([]);
    setActiveTab("books");
  }
  function openTask(task: Task) {
    setDraft({
      id: task.id,
      date: task.taskDate,
      subject: task.subject,
      title: task.title,
      durationMinutes: task.durationMinutes,
      details: task.details,
      status: task.status,
    });
    const marker = task.details.match(/\[resource:(\d+)\]/)?.[1];
    const resourceId = marker ? Number(marker) : null;
    const resource = resourceId
      ? resources.find((item) => item.id === resourceId)
      : resources.find((item) => task.title.includes(item.title));
    if (resource) {
      setSelectedResourceId(resource.id);
      setSelectedSegmentId(null);
      setSelectedChapterId(null);
      setBookMessages([]);
      setActiveTab(resource.resourceType === "course" ? "courses" : "books");
    }
  }

  async function save() {
    if (!draft?.title.trim()) {
      setMessage("請輸入任務名稱");
      return;
    }
    const response = await fetch("/api/study-plan", {
      method: draft.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: draft.id,
        planId: plans[0]?.id,
        ...draft,
      }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setMessage(result.error ?? "儲存失敗");
      return;
    }
    setDraft(null);
    setMessage("");
    await load();
  }

  async function remove() {
    if (!draft?.id) return;
    await fetch(`/api/study-plan?taskId=${draft.id}`, { method: "DELETE" });
    setDraft(null);
    await load();
  }

  async function toggle(task: Task) {
    await fetch("/api/study-plan", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        status: task.status === "completed" ? "pending" : "completed",
      }),
    });
    await load();
  }

  async function clearAndReplan() {
    setResetPlanLoading(true);
    setResetPlanMessage("");
    try {
      const clearOnlySubject =
        resetPlanDraft.mode === "single" &&
        resetPlanDraft.clearScope === "subject";
      const target =
        resetPlanDraft.mode === "single"
          ? `${resetPlanDraft.subject}（${resetPlanDraft.scope}）單科專攻`
          : "司律全科備考";
      const priorityInstruction =
        resetPlanDraft.priorityMode === "core-first"
          ? "以高投報核心考點優先：先安排近年反覆出題、可連回多題真題的考點；但不得只看頻率，仍須補入學生已辨識的重大弱點。"
          : "採自適應優先序：綜合歷屆出題頻率、近五年趨勢、學生錯題與弱點、距離考試時間安排；弱點相同時先排高頻核心考點。";
      const prompt = `請立即依照我的既有學習紀錄、作答結果、弱點與目前進度，建立一份從今天開始的 ${resetPlanDraft.days} 天「${target}」讀書計畫。程度：${resetPlanDraft.level}；每日可用時間：${resetPlanDraft.dailyMinutes} 分鐘；學習目標：${resetPlanDraft.goals.join("、")}；納入資源：${resetPlanDraft.resources.join("、")}。${priorityInstruction}${resetPlanDraft.mode === "single" ? `所有新任務都必須屬於「${resetPlanDraft.subject}」，並聚焦「${resetPlanDraft.scope}」。` : "請依弱點與考試重要性分配各科比重。"}每項任務的 details 要簡短標示安排原因（核心高頻／個人弱點／間隔複習）與具體產出。避免重複已完成內容，安排間隔複習，並直接使用 save_study_plan 寫入行事曆。`;
      const planResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "student", text: prompt }],
          // 這是後端專用的規劃指令，不要把完整 prompt 寫入首頁對話紀錄。
          persistStudentMessage: false,
          planningConstraint:
            resetPlanDraft.mode === "single"
              ? {
                  mode: "single",
                  subject: resetPlanDraft.subject,
                  scope: resetPlanDraft.scope,
                  replaceOnlySubject: resetPlanDraft.clearScope === "subject",
                  days: resetPlanDraft.days,
                  dailyMinutes: resetPlanDraft.dailyMinutes,
                }
              : {
                  mode: "all",
                  subject: "",
                  scope: "",
                  replaceOnlySubject: false,
                  days: resetPlanDraft.days,
                  dailyMinutes: resetPlanDraft.dailyMinutes,
                },
        }),
      });
      const planResult = (await planResponse.json()) as {
        planSaved?: boolean;
        replacedTasks?: number;
        error?: string;
      };
      if (!planResponse.ok || !planResult.planSaved)
        throw new Error(
          planResult.error ??
            "AI 尚未成功建立新計畫，原行程未變動，請再試一次。",
        );
      setResetPlanMessage(
        `已替換 ${planResult.replacedTasks ?? 0} 項${clearOnlySubject ? resetPlanDraft.subject : ""}舊行程，AI 已重新安排接下來的讀書計畫。`,
      );
      await load();
      window.setTimeout(() => {
        setResetPlanOpen(false);
        setResetPlanMessage("");
      }, 1200);
    } catch (error) {
      setResetPlanMessage(
        error instanceof Error ? error.message : "重新規劃失敗，請稍後再試。",
      );
      await load();
    } finally {
      setResetPlanLoading(false);
    }
  }

  function togglePlanningItem(key: "goals" | "resources", value: string) {
    const current = resetPlanDraft[key];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    setResetPlanDraft({ ...resetPlanDraft, [key]: next });
  }

  function openResetPlanner() {
    setResetPlanDraft((current) => ({
      ...current,
      dailyMinutes: plans[0]?.dailyMinutes ?? current.dailyMinutes,
      step: "settings",
    }));
    setResetPlanMessage("");
    setResetPlanOpen(true);
  }

  function moveMonth(delta: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const nextMonth = monthValue(new Date(year, monthNumber - 1 + delta, 1));
    setMonth(nextMonth);
    setSelectedCalendarDate(`${nextMonth}-01`);
  }

  const selectedCalendarTasks = tasks.filter(
    (task) => task.taskDate === selectedCalendarDate,
  );

  const filteredNotes = notes.filter(
    (note) =>
      !noteQuery.trim() ||
      `${note.title} ${note.content} ${note.tags} ${note.subject}`
        .toLowerCase()
        .includes(noteQuery.trim().toLowerCase()),
  );
  const visibleRecords = records.slice((recordPage - 1) * 10, recordPage * 10);
  const visibleRecordIds = visibleRecords.map((record) => record.id);
  const allVisibleRecordsSelected = visibleRecordIds.length > 0 && visibleRecordIds.every((id) => selectedRecordIds.has(id));
  const coachPreviewData = useMemo(() => coachPreview(records), [records]);
  const coachData = learningAnalysis ?? coachPreviewData;
  const learningSnapshot = useMemo(() => {
    const subjectMinutes = new Map<string, number>();
    const weaknessCounts = new Map<string, number>();
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    let totalMinutes = 0;

    records.forEach((record) => {
      totalMinutes += record.actualMinutes;
      subjectMinutes.set(record.subject, (subjectMinutes.get(record.subject) ?? 0) + record.actualMinutes);
      const weakness = record.weakness.trim();
      if (weakness) weaknessCounts.set(weakness, (weaknessCounts.get(weakness) ?? 0) + 1);
      if (record.correct === true) correct += 1;
      else if (record.correct === false) incorrect += 1;
      else unanswered += 1;
    });

    const subjectsByMinutes = [...subjectMinutes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxSubjectMinutes = subjectsByMinutes[0]?.[1] ?? 0;
    const weaknesses = [...weaknessCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const answered = correct + incorrect;

    return {
      totalMinutes,
      correct,
      incorrect,
      unanswered,
      answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : null,
      subjectsByMinutes,
      maxSubjectMinutes,
      weaknesses,
    };
  }, [records]);
  const visibleNotes = filteredNotes.slice((notePage - 1) * 10, notePage * 10);
  function youtubeEmbedUrl(value: string, startSeconds = 0) {
    try {
      const url = new URL(value.trim());
      let id =
        url.hostname === "youtu.be"
          ? url.pathname.slice(1)
          : url.searchParams.get("v") ||
            (url.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? "");
      id = id.split(/[?&]/)[0];
      const playlistId = url.searchParams.get("list")?.trim() ?? "";
      const validVideoId = /^[A-Za-z0-9_-]{6,}$/.test(id);
      const validPlaylistId = /^[A-Za-z0-9_-]{6,}$/.test(playlistId);
      if (!validVideoId && !validPlaylistId) return "";
      const params = new URLSearchParams({
        rel: "0",
        controls: "1",
        modestbranding: "1",
        playsinline: "1",
        enablejsapi: "1",
      });
      if (validPlaylistId) params.set("list", playlistId);
      if (startSeconds > 0) params.set("start", String(Math.floor(startSeconds)));
      return validVideoId
        ? `https://www.youtube.com/embed/${id}?${params.toString()}`
        : `https://www.youtube.com/embed/videoseries?${params.toString()}`;
    } catch {
      return "";
    }
  }

  function isYoutubePlaylist(value: string) {
    try {
      return Boolean(new URL(value.trim()).searchParams.get("list"));
    } catch {
      return false;
    }
  }

  function applyYoutubePlaybackRate(rate: number) {
    const iframe = document.querySelector<HTMLIFrameElement>(".course-youtube-frame");
    iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setPlaybackRate", args: [rate] }), "https://www.youtube.com");
  }

  const bookResources = resources
    .filter(
      (item) => item.resourceType === "book" && item.status !== "archived",
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const courseResources = resources
    .filter(
      (item) =>
        item.resourceType === "course" &&
        item.status !== "archived" &&
        courseCollectionsLoaded &&
        item.courseCategory !== "public",
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const publicCourseSubjects = [
    "全部",
    ...new Set(
      courseCollections.flatMap((collection) =>
        collection.courses.map((course) => course.subject).filter(Boolean),
      ),
    ),
  ];
  const selectedMyCourse = myCourses.find((course) => course.id === selectedMyCourseId) ?? myCourses[0] ?? null;
  const selectedMyPlaylistItems = selectedMyCourse ? myCoursePlaylistItems[selectedMyCourse.id] ?? [] : [];
  const selectedMyEpisode = selectedMyPlaylistItems.find((item) => item.videoId === selectedMyEpisodeId) ?? selectedMyPlaylistItems[0] ?? null;
  const selectedPublicCourse = courseCollections
    .flatMap((collection) => collection.courses)
    .find((course) => course.id === selectedPublicCourseId) ??
    courseCollections
      .flatMap((collection) => collection.courses)
      .find((course) => publicCourseSubject === "全部" || course.subject === publicCourseSubject) ??
    null;
  const selectedPublicPlaylistItems = selectedPublicCourse ? playlistItemsByCourse[selectedPublicCourse.id] ?? [] : [];
  const selectedPublicEpisode = selectedPublicPlaylistItems.find((item) => item.videoId === selectedPublicEpisodeId) ?? selectedPublicPlaylistItems[0] ?? null;
  const myCourseNotes = selectedMyCourse
    ? notes.filter((note) => note.sourceId === `my-course:${selectedMyCourse.id}:${selectedMyEpisode?.videoId ?? "course"}`)
    : [];
  const publicCourseNotes = selectedPublicCourse
    ? notes.filter((note) => note.sourceId === `public-course:${selectedPublicCourse.id}:${selectedPublicEpisode?.videoId ?? "course"}`)
    : [];
  const magazineFeeds =
    homeFeed?.magazines ?? (homeFeed?.magazine ? [homeFeed.magazine] : []);
  const magazineYears = [...new Set(magazineFeeds.map(magazineYear))].sort(
    (a, b) => b.localeCompare(a, "zh-Hant"),
  );
  const normalizedMagazineQuery = magazineQuery
    .trim()
    .toLocaleLowerCase("zh-Hant");
  const filteredMagazines = magazineFeeds
    .filter((magazine) => {
      if (
        magazineYearFilter !== "全部年度" &&
        magazineYear(magazine) !== magazineYearFilter
      )
        return false;
      if (!normalizedMagazineQuery) return true;
      const searchable = [
        magazine.title,
        magazine.description,
        ...(magazine.articles ?? []).flatMap((article) => [
          article.title,
          article.summary,
          article.issue,
        ]),
        ...(magazine.catalog ?? []).flatMap((item) => [
          item.title,
          item.category,
          item.author,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase("zh-Hant");
      return searchable.includes(normalizedMagazineQuery);
    })
    .sort(
      (a, b) =>
        magazineYear(b).localeCompare(magazineYear(a), "zh-Hant", {
          numeric: true,
        }) ||
        magazineIssueNumber(b) - magazineIssueNumber(a) ||
        b.id - a.id,
    );
  const selectedMagazine =
    filteredMagazines.find((magazine) => magazine.id === selectedMagazineId) ??
    filteredMagazines[0] ??
    null;
  const defaultExpandedBookId =
    selectedResourceId === null ? (bookResources[0]?.id ?? null) : null;
  const currentExpandedBookId = expandedBookId ?? defaultExpandedBookId;
  const selectedResource =
    (activeTab === "courses"
      ? courseResources.find((item) => item.id === selectedResourceId)
      : resources.find(
          (item) => item.id === selectedResourceId && item.resourceType === "book",
        )) ??
    (activeTab === "courses" ? courseResources[0] : bookResources[0]) ??
    null;
  const selectedProgress = selectedResource
    ? resourceProgress[String(selectedResource.id)]
    : undefined;
  const selectedSegment =
    resourceSegments.find(
      (segment) =>
        segment.id === (selectedSegmentId ?? selectedProgress?.segmentId),
    ) ?? null;
  const courseSummarySegments = resourceSegments.filter(
    (segment) => segment.summary.trim() || segment.recommended,
  );
  const selectedChapter =
    bookChapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const selectedBookIsProblemSolving = isProblemSolvingBook(selectedResource);
  const selectedBookOutline = useMemo(
    () =>
      selectedBookIsProblemSolving ? problemBookOutline(bookChapters) : [],
    [bookChapters, selectedBookIsProblemSolving],
  );
  const bookSearchTerms = useMemo(() => {
    const query = bookSearchQuery.trim();
    if (!query) return [];
    const aliases: Record<string, string[]> = {
      正當防衛: ["防衛", "不法侵害", "防衛過當"],
      客觀歸責: ["製造風險", "實現風險", "規範保護目的"],
      原因自由行為: ["原因自由", "自陷無責任能力"],
      不作為犯: ["不作為", "保證人地位", "作為義務"],
      因果關係: ["因果", "條件關係", "相當因果"],
      故意: ["故意", "構成要件故意", "未必故意"],
      未遂犯: ["未遂", "障礙未遂", "普通未遂", "著手"],
      不能未遂: ["不能犯", "不能未遂", "重大無知", "危險性"],
    };
    const base = query
      .split(/[\s、，,；;／/與及]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    const concepts = Object.keys(aliases).filter((concept) =>
      query.includes(concept),
    );
    return [
      ...new Set(
        [...base, ...concepts].flatMap((term) => [
          term,
          ...(aliases[term] ?? []),
        ]),
      ),
    ];
  }, [bookSearchQuery]);
  const bookSearchResults = useMemo(() => {
    if (!bookSearchTerms.length) return [];
    return bookChapters
      .map((chapter, index) => {
        const title = chapter.title.toLocaleLowerCase("zh-Hant");
        const summary = chapter.summary.toLocaleLowerCase("zh-Hant");
        const matched = bookSearchTerms.filter((term) =>
          `${title} ${summary}`.includes(term.toLocaleLowerCase("zh-Hant")),
        );
        const score = matched.reduce(
          (total, term) =>
            total +
            (title.includes(term.toLocaleLowerCase("zh-Hant")) ? 8 : 3) +
            term.length,
          0,
        );
        return { chapter, index, matched, score };
      })
      .filter((item) => item.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.chapter.sequence - b.chapter.sequence,
      )
      .slice(0, 8);
  }, [bookChapters, bookSearchTerms]);

  function highlightBookText(text: string): ReactNode {
    const terms = bookSearchTerms
      .filter((term) =>
        text
          .toLocaleLowerCase("zh-Hant")
          .includes(term.toLocaleLowerCase("zh-Hant")),
      )
      .sort((a, b) => b.length - a.length);
    if (!terms.length) return text;
    const escaped = terms.map((term) =>
      term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const matcher = new RegExp(`(${escaped.join("|")})`, "giu");
    return text.split(matcher).map((part, index) =>
      terms.some(
        (term) =>
          part.toLocaleLowerCase("zh-Hant") ===
          term.toLocaleLowerCase("zh-Hant"),
      ) ? (
        <mark className="book-search-highlight" key={`${part}-${index}`}>
          {part}
        </mark>
      ) : (
        part
      ),
    );
  }

  async function searchBookFullText(
    event?: FormEvent<HTMLFormElement>,
    requestedQuery?: string,
  ) {
    event?.preventDefault();
    const query = (requestedQuery ?? bookSearchQuery).trim();
    if (
      !selectedResource ||
      selectedResource.resourceType !== "book" ||
      query.length < 2 ||
      bookFullTextLoading
    )
      return;
    setBookFullTextLoading(true);
    setBookFullTextHits([]);
    setBookFullTextMessage("");
    try {
      const response = await fetch("/api/resources/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: selectedResource.id, query }),
      });
      const result = (await response.json()) as {
        hits?: BookFullTextHit[];
        error?: string;
      };
      if (!response.ok)
        setBookFullTextMessage(result.error ?? "教材全文搜尋暫時無法使用");
      else {
        setBookFullTextHits(result.hits ?? []);
        setBookFullTextMessage(
          result.hits?.length
            ? "以下結果來自這本書的教材全文索引。"
            : `教材全文也未找到「${query}」；可能需改用同義詞，或確認這本書是否收錄該主題。`,
        );
      }
    } catch {
      setBookFullTextMessage("教材全文搜尋暫時無法使用，請稍後再試。");
    } finally {
      setBookFullTextLoading(false);
    }
  }

  useEffect(() => {
    const query = bookSearchQuery.trim();
    if (
      activeTab !== "books" ||
      selectedResource?.resourceType !== "book" ||
      query.length < 2 ||
      bookChaptersLoading
    )
      return;
    const timer = window.setTimeout(
      () => void searchBookFullText(undefined, query),
      650,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedResource?.id, bookSearchQuery, bookChaptersLoading]);

  function chapterForFullTextHit(hit: BookFullTextHit) {
    const byPage =
      hit.page_start == null
        ? null
        : bookChapters.find(
            (chapter) =>
              chapter.pageStart != null &&
              chapter.pageEnd != null &&
              hit.page_start! >= chapter.pageStart &&
              hit.page_start! <= chapter.pageEnd,
          );
    if (byPage) return byPage;
    const terms = `${hit.section} ${bookSearchQuery}`
      .split(/[\s、，,；;／/與及的]+/)
      .filter((term) => term.length >= 2);
    const [best] = bookChapters
      .map((chapter) => ({
        chapter,
        score: terms.reduce(
          (score, term) =>
            score +
            (`${chapter.title} ${chapter.summary}`.includes(term)
              ? term.length
              : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score);
    return best?.score > 0 ? best.chapter : null;
  }
  const courseEvidence = [selectedSegment?.summary, selectedSegment?.text]
    .filter(Boolean)
    .join("\n")
    .trim();
  const hasCourseEvidence = courseEvidence.length > 0;

  useEffect(() => {
    if (activeTab !== "courses" || !selectedResource) return;
    setCourseAiReply("");
    setCourseAiNotice(
      hasCourseEvidence
        ? ""
        : "目前時間點沒有摘要、字幕或教材內容，AI 不會憑空生成；請先選擇右側有內容的重點，或使用截圖問 AI。",
    );
  }, [activeTab, selectedResource?.id, selectedSegment?.id, hasCourseEvidence]);

  useEffect(() => {
    if (!courseAiLoading) return;
    setCourseAiStage(0);
    const timers = [
      window.setTimeout(() => setCourseAiStage(1), 650),
      window.setTimeout(() => setCourseAiStage(2), 1500),
      window.setTimeout(() => setCourseAiStage(3), 2500),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [courseAiLoading]);

  function captureCourseFrame() {
    setCourseAiNotice("");
    const video = document.querySelector<HTMLVideoElement>(
      ".course-player video",
    );
    if (!video) {
      setCourseAiNotice(
        "這堂課使用跨站內嵌播放器，瀏覽器無法直接擷取畫面；可改用裝置截圖後，到首頁 AI 對話貼上提問。",
      );
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setCourseAiNotice("請先播放影片，等畫面出現後再截圖。");
      return;
    }
    try {
      const scale = Math.min(
        1,
        1600 / Math.max(video.videoWidth, video.videoHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCourseCapture(canvas.toDataURL("image/jpeg", 0.82));
      setCourseAiNotice("已擷取目前畫面，可在下方直接提問。");
    } catch {
      setCourseAiNotice(
        "影片來源未允許畫面擷取，請改用裝置截圖後，到首頁 AI 對話貼上提問。",
      );
    }
  }

  async function askCourseAi(
    prompt: string,
    imageDataUrl = "",
    actionLabel = "整理答案",
  ) {
    if (!selectedResource || !prompt.trim() || courseAiLoading) return;
    if (!imageDataUrl && !hasCourseEvidence) {
      setCourseAiReply("");
      setCourseAiNotice(
        "目前時間點沒有摘要、字幕或教材內容，AI 不會憑空生成。請先選擇右側有內容的重點，或使用截圖問 AI。",
      );
      return;
    }
    setCourseAiAction(actionLabel);
    setCourseAiLoading(true);
    setCourseAiReply("");
    setCourseAiNotice("");
    const time =
      selectedProgress?.positionSeconds ?? selectedSegment?.startSeconds ?? 0;
    const context = `課程：${selectedResource.title}；科目：${selectedResource.subject}；目前時間：${formatMediaTime(time)}；目前重點：${selectedSegment?.title || "尚未選定"}；可用課程內容：${courseEvidence.slice(0, 6000) || "僅有學生提供的截圖"}。`;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "student",
              text: `${context}\n學生問題：${prompt.trim()}\n請只處理這段課程的學習問題；若畫面、摘要或教材依據不足，明確說明，不要猜測。`,
            },
          ],
          imageDataUrl: imageDataUrl || undefined,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "AI 暫時無法回應");
      setCourseAiReply(
        result.reply || "AI 尚未產生回答，請換一種問法再試一次。",
      );
    } catch (error) {
      setCourseAiNotice(
        error instanceof Error ? error.message : "AI 暫時無法回應",
      );
    } finally {
      setCourseAiLoading(false);
    }
  }

  function submitCourseQuestion(event: FormEvent) {
    event.preventDefault();
    const question =
      courseAiInput.trim() ||
      "請解釋畫面中的內容，並說明它和目前課程重點的關係。";
    void askCourseAi(
      question,
      courseCapture,
      courseCapture ? "解析截圖" : "回答問題",
    );
  }

  function todayValue() {
    return taipeiDate();
  }
  function updateResourceProgress(
    resourceId: number,
    next: Partial<{
      page: number;
      segmentId: number | null;
      positionSeconds: number;
    }>,
  ) {
    const updated = {
      page: 1,
      segmentId: null,
      positionSeconds: 0,
      updatedAt: new Date().toISOString(),
      ...resourceProgress[String(resourceId)],
      ...next,
    };
    const nextState = { ...resourceProgress, [String(resourceId)]: updated };
    setResourceProgress(nextState);
    window.localStorage.setItem(
      "silu-resource-progress",
      JSON.stringify(nextState),
    );
  }
  async function addResourceTask(resource: LearningResource) {
    const isCourse = resource.resourceType === "course";
    const response = await fetch("/api/study-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: todayValue(),
        subject: resource.subject || "綜合",
        title: `${isCourse ? "影音" : "閱讀"}｜${resource.title}`,
        durationMinutes: isCourse ? 45 : 60,
        details: `[resource:${resource.id}] ${resource.description || `在學習專區內${isCourse ? "觀看課程與字幕" : "閱讀書籍內容"}，完成後留下接續點。`}`,
      }),
    });
    const result = (await response.json()) as { error?: string };
    setResourceMessage(
      response.ok
        ? "已加入今天的行事曆，完成後會寫入學習紀錄。"
        : (result.error ?? "加入今日計畫失敗"),
    );
    if (response.ok) await load();
  }
  async function logResourceStudy(
    resource: LearningResource,
    actualMinutes: number,
    nextStep: string,
  ) {
    const segmentLabel =
      resource.resourceType === "book"
        ? selectedChapter
          ? `｜${selectedChapter.title}`
          : ""
        : selectedSegment
          ? `｜${selectedSegment.title}`
          : "";
    const response = await fetch("/api/learning-records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recordDate: todayValue(),
        subject: resource.subject || "綜合",
        title: `${resource.title}${segmentLabel}`,
        activityType:
          resource.resourceType === "course" ? "影音課程學習" : "書籍學習",
        actualMinutes,
        nextStep,
      }),
    });
    setResourceMessage(
      response.ok
        ? "已記錄今天的學習內容；AI 導師下次對話會讀取這筆紀錄。"
        : "學習紀錄暫時無法儲存",
    );
    if (response.ok) {
      const result = (await response.json()) as { record?: StudyRecord };
      if (result.record) setRecords((current) => [result.record!, ...current]);
    }
  }

  function bookContext(chapter: ResourceSegment) {
    const pages = chapter.pageStart
      ? `（第 ${chapter.pageStart}${chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""} 頁）`
      : "";
    return `教材：《${selectedResource?.title ?? ""}》；科目：${selectedResource?.subject ?? "綜合"}；目前章節：${chapter.title}${pages}。${chapter.summary ? `章節摘要：${chapter.summary}` : ""}`;
  }

  async function startBookChapter(
    chapter: ResourceSegment,
    forceRestart = false,
    focusPoint = "",
  ) {
    if (!selectedResource || selectedResource.resourceType !== "book") return;
    setSelectedChapterId(chapter.id);
    setBookMessages([]);
    setBookSessionId(null);
    setBookInput("");
    setBookSelectedMessageIndex(null);
    setBookQuestionOpen(true);
    setBookTestNotice("");
    setBookChatLoading(true);
    setBookLoadingRole(selectedBookIsProblemSolving ? null : "mentor");
    if (!forceRestart) {
      try {
        const resumeExactSession =
          lastBookSessionId &&
          lastBookProgress?.resourceId === selectedResource.id &&
          lastBookProgress.segmentId === chapter.id;
        const historyResponse = await fetch(resumeExactSession
          ? `/api/book-learning?sessionId=${lastBookSessionId}`
          : `/api/book-learning?resourceId=${selectedResource.id}&segmentId=${chapter.id}`);
        const history = (await historyResponse.json()) as {
          sessionId?: number | null;
          messages?: TutorMessage[];
          history?: BookHistoryEntry[];
        };
        if (history.history) setBookHistory(history.history);
        if (historyResponse.ok && history.messages?.length) {
          setBookSessionId(history.sessionId ?? null);
          setLastBookSessionId(history.sessionId ?? null);
          setBookMessages(history.messages);
          setLastBookProgress({
            resourceId: selectedResource.id,
            segmentId: chapter.id,
          });
          void persistBookPreferences({ lastBookResourceId: selectedResource.id, lastBookSegmentId: chapter.id, lastBookSessionId: history.sessionId ?? null });
          setBookChatLoading(false);
          setBookLoadingRole(null);
          return;
        }
      } catch {
        /* start a fresh chapter below */
      }
    }
    if (selectedBookIsProblemSolving) {
      setBookChatLoading(false);
      setBookLoadingRole(null);
      setLastBookProgress({
        resourceId: selectedResource.id,
        segmentId: chapter.id,
      });
      void persistBookPreferences({ lastBookResourceId: selectedResource.id, lastBookSegmentId: chapter.id, lastBookSessionId: null });
      updateResourceProgress(selectedResource.id, {
        segmentId: chapter.id,
        page: chapter.pageStart ?? 1,
      });
      return;
    }
    const focus = focusPoint
      ? `\n本次從熱考點「${focusPoint}」進入，請先在本章教材中定位與這個考點最相關的內容；若本章沒有足夠依據，請明確告知，不要補造。`
      : "";
    const prompt = selectedBookIsProblemSolving
      ? `${bookContext(chapter)}${focus}\n這是解題書中的題目或題組，不是一般授課章節。請先確認教材索引中有實際題目與解析依據；若只有目錄或摘要，明確告知資料不足。若資料足夠，依序帶我做：重述題目事實、辨認題型、圈出關鍵事實、列爭點、說明作答架構，再逐步分析規範與涵攝。先從審題提問開始，不要直接講課或一次公布完整擬答。`
      : `${bookContext(chapter)}${focus}\n請開始教我這一章。先用一小段話說明本章要學會什麼，再提出一個學生可以直接回答的問題；請嚴格以這本教材為優先依據，不要先傾倒完整解答。`;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "student", text: prompt }],
          visibleStudentText: selectedBookIsProblemSolving ? "開始學習題目" : "開始學習本章",
          modelMode: bookModelMode,
          context: {
            type: "book",
            resourceId: selectedResource.id,
            segmentId: chapter.id,
            resourceTitle: selectedResource.title,
            segmentTitle: chapter.title,
          },
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
        sessionId?: number;
        usage?: BookUsage;
        comparison?: BookComparison | null;
        teachingEvidence?: TeachingEvidence | null;
      };
      setBookSessionId(result.sessionId ?? null);
      setLastBookSessionId(result.sessionId ?? null);
      setLastBookProgress({
        resourceId: selectedResource.id,
        segmentId: chapter.id,
      });
      void persistBookPreferences({ lastBookResourceId: selectedResource.id, lastBookSegmentId: chapter.id, lastBookSessionId: result.sessionId ?? null });
      setBookMessages([
        {
          role: "student",
          text: selectedBookIsProblemSolving ? "開始學習題目" : "開始學習本章",
        },
        {
          role: "mentor",
          text: response.ok
            ? (result.reply ?? "我們先從這一章開始。")
            : (result.error ?? "AI 教學暫時無法開始"),
          model: result.usage?.model,
          usage: result.usage,
          comparison: result.comparison ?? undefined,
          teachingEvidence: response.ok ? result.teachingEvidence ?? null : null,
        },
      ]);
      void loadBookHistory(selectedResource.id);
    } catch {
      setBookMessages([
        {
          role: "mentor",
          text: "教材章節已開啟，但 AI 暫時沒有回應。請稍後再按一次章節。",
        },
      ]);
    } finally {
      setBookChatLoading(false);
      setBookLoadingRole(null);
    }
  }

  async function openBookHistory(entry: BookHistoryEntry) {
    if (!selectedResource || selectedResource.resourceType !== "book" || bookChatLoading) return;
    const chapter = bookChapters.find((item) => item.id === entry.segmentId);
    if (chapter) {
      setSelectedChapterId(chapter.id);
      setLastBookProgress({ resourceId: selectedResource.id, segmentId: chapter.id });
      updateResourceProgress(selectedResource.id, { segmentId: chapter.id, page: chapter.pageStart ?? 1 });
    }
    setBookChatLoading(true);
    setBookLoadingRole(null);
    try {
      const response = await fetchBookConversation(`/api/book-learning?sessionId=${entry.id}`, { method: "GET" });
      const result = await response.json() as { sessionId?: number; messages?: TutorMessage[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "這段學習紀錄暫時無法讀取");
      setBookSessionId(result.sessionId ?? entry.id);
      setLastBookSessionId(result.sessionId ?? entry.id);
      setBookMessages(result.messages ?? []);
      setBookHistoryOpen(false);
      setBookTestNotice("");
    } catch (error) {
      setBookTestNotice(error instanceof Error ? error.message : "這段學習紀錄暫時無法讀取");
    } finally {
      setBookChatLoading(false);
      setBookLoadingRole(null);
    }
  }

  async function startBookReview() {
    if (!selectedChapter || !selectedResource || selectedResource.resourceType !== "book" || bookChatLoading) return;
    const prompt = `${bookContext(selectedChapter)}\n這是解題書中的題目或題組。請依老師解析開始一對一引導教學，不要要求學生先交完整答案。第一輪只做兩件事：先用一句話說明本題要學會什麼，再指出一個具體行為或關鍵事實，提出一個學生可以直接回答的短問題。學生回答後，再依序引導辨認行為人、爭點、判準、學說、涵攝與結論；每輪先消化學生上一句回答，給具體回饋後只問一個問題。先不要公布完整擬答；完成理解後再整理完整解題架構。`;
    setBookQuestionOpen(false);
    setBookInput("");
    setBookSelectedMessageIndex(null);
    setBookChatLoading(true);
    setBookLoadingRole("mentor");
    setBookTestNotice("AI 導師正在準備引導教學…");
    try {
      const response = await fetchBookConversation("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "student", text: prompt }],
          visibleStudentText: "開始引導教學",
          modelMode: bookModelMode,
          context: {
            type: "book",
            resourceId: selectedResource.id,
            segmentId: selectedChapter.id,
            resourceTitle: selectedResource.title,
            segmentTitle: selectedChapter.title,
          },
        }),
      });
      const result = await response.json() as {
        reply?: string;
        error?: string;
        sessionId?: number;
        usage?: BookUsage;
        comparison?: BookComparison | null;
        teachingEvidence?: TeachingEvidence | null;
      };
      setBookSessionId(result.sessionId ?? null);
      setLastBookSessionId(result.sessionId ?? null);
      void persistBookPreferences({ lastBookResourceId: selectedResource.id, lastBookSegmentId: selectedChapter.id, lastBookSessionId: result.sessionId ?? null });
      setBookMessages([{
        role: "student",
        text: "開始引導教學",
      }, {
        role: "mentor",
        text: response.ok ? (result.reply ?? "我們先從題目的關鍵行為開始。") : (result.error ?? "AI 引導教學暫時無法開始"),
        model: result.usage?.model,
        usage: result.usage,
        comparison: result.comparison ?? undefined,
        teachingEvidence: response.ok ? result.teachingEvidence ?? null : null,
      }]);
      void loadBookHistory(selectedResource.id);
      setBookTestNotice("");
    } catch {
      setBookMessages([{ role: "mentor", text: "AI 審題暫時沒有回應，請稍後再按一次「開始審題」。" }]);
      setBookTestNotice("");
    } finally {
      setBookChatLoading(false);
      setBookLoadingRole(null);
    }
  }

  useEffect(() => {
    if (
      activeTab !== "books" ||
      !pendingBookPoint ||
      !bookChapters.length ||
      !selectedResource ||
      selectedResource.resourceType !== "book"
    )
      return;
    const terms = pendingBookPoint.title
      .split(/[、，與及的]/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    const ranked = bookChapters
      .map((chapter) => {
        const haystack = `${chapter.title} ${chapter.summary}`;
        const score = terms.reduce(
          (total, term) => total + (haystack.includes(term) ? term.length : 0),
          0,
        );
        return { chapter, score };
      })
      .sort(
        (a, b) => b.score - a.score || a.chapter.sequence - b.chapter.sequence,
      );
    const best = ranked[0];
    if (!best || best.score <= 0) {
      setBookSearchQuery(pendingBookPoint.title);
      setResourceMessage(
        `在《${selectedResource.title}》目前的目錄與摘要中，尚未確認「${pendingBookPoint.title}」對應位置；已替你填入搜尋詞，請從結果確認，不會任意跳到第一章。`,
      );
      setPendingBookPoint(null);
      return;
    }
    const chapter = best.chapter;
    const focusPoint = pendingBookPoint.title;
    setPendingBookPoint(null);
    void startBookChapter(chapter, false, focusPoint);
  }, [activeTab, pendingBookPoint, bookChapters, selectedResource]);

  useEffect(() => {
    if (
      activeTab !== "books" ||
      !lastBookProgress ||
      restoredBookProgressRef.current
    )
      return;
    const resource = resources.find(
      (item) =>
        item.id === lastBookProgress.resourceId &&
        item.resourceType === "book" &&
        item.status !== "archived",
    );
    if (!resource) return;
    restoredBookProgressRef.current = true;
    const timer = window.setTimeout(() => {
      setSelectedResourceId(resource.id);
      setExpandedBookId(resource.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, lastBookProgress, resources]);

  useEffect(() => {
    if (
      !lastBookProgress ||
      selectedResourceId !== lastBookProgress.resourceId ||
      selectedChapterId !== null
    )
      return;
    const chapter = bookChapters.find(
      (item) => item.id === lastBookProgress.segmentId,
    );
    if (!chapter) return;
    const timer = window.setTimeout(() => {
      void startBookChapter(chapter);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookChapters, lastBookProgress, selectedChapterId, selectedResourceId]);

  function persistBookPreferences(patch: Record<string, unknown>) {
    return fetch("/api/book-learning/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
  }

  function saveBookAiSettings(next: { pinned?: boolean; modelMode?: BookModelMode; teachingLevel?: "beginner" | "intermediate" | "advanced" | "super" | null }) {
    const pinned = next.pinned ?? bookSettingsPinned;
    const modelMode = next.modelMode ?? bookModelMode;
    const teachingLevel = next.teachingLevel === undefined ? bookTeachingLevel : next.teachingLevel;
    window.localStorage.setItem("silu-book-ai-settings-pinned", JSON.stringify({ pinned, modelMode, teachingLevel }));
    void persistBookPreferences({ bookSettingsPinned: pinned, bookModelMode: modelMode, bookTeachingLevel: teachingLevel });
  }

  function toggleBookSettingsPinned(checked: boolean) {
    setBookSettingsPinned(checked);
    saveBookAiSettings({ pinned: checked });
  }

  useEffect(() => {
    setChallengeStudentAnswer("");
    setChallengeAnswers({});
    setChallengeVote("");
    setChallengeReason("");
    setChallengeCoachRun(null);
    setChallengeReply(null);
    setChallengeLoading(null);
  }, [selectedChapterId]);

  async function runModelChallenge(action: "answer" | "challenge" | "reply", provider?: "luna" | "sol") {
    if (!selectedChapter || challengeLoading) return;
    const question = studentProblemQuestion(selectedChapter.text, selectedChapter.title);
    const teacherAnswer = teacherProblemAnswer(selectedChapter.text);
    if (!question || !teacherAnswer) {
      setBookTestNotice("本題尚未取得可核對的完整老師解析／擬答，暫不開放模型評選與質疑。");
      return;
    }
    const loading = action === "answer" ? provider! : action === "challenge" ? "coach" : "reply";
    setChallengeLoading(loading);
    setChallengeReply(action === "reply" ? null : challengeReply);
    try {
      const target = provider ?? (challengeVote === "luna" ? "luna" : "sol");
      const response = await fetch("/api/book-learning/model-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          provider: target,
          challenger: challengeCoach,
          question,
          teacherAnswer,
          studentAnswer: challengeStudentAnswer,
          lunaAnswer: challengeAnswers.luna?.reply,
          solAnswer: challengeAnswers.sol?.reply,
          challenge: challengeReason || challengeCoachRun?.reply,
          originalAnswer: challengeAnswers[target]?.reply,
        }),
      });
      const result = await response.json() as ChallengeRun & { error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "模型挑戰暫時無法完成");
      if (action === "answer" && provider) setChallengeAnswers((current) => ({ ...current, [provider]: result }));
      if (action === "challenge") { setChallengeCoachRun(result); if (!challengeReason.trim()) setChallengeReason(result.reply); }
      if (action === "reply") setChallengeReply(result);
      setBookTestNotice("");
    } catch (error) {
      setBookTestNotice(error instanceof Error ? error.message : "模型挑戰暫時無法完成");
    } finally {
      setChallengeLoading(null);
    }
  }

  async function answerBookTeacherMessage() {
    if (!selectedChapter || !selectedResource || bookChatLoading) return;
    const selectedMessage = bookSelectedMessageIndex !== null && bookMessages[bookSelectedMessageIndex]?.role === "mentor"
      ? bookMessages[bookSelectedMessageIndex]
      : [...bookMessages].reverse().find((message) => message.role === "mentor" && message.text.trim());
    if (!selectedMessage) return;
    if (bookModelMode.startsWith("compare-")) {
      setBookTestNotice("AI 學霸回答老師問題時請先選一個單一模型；比較模式保留給模型測試。" );
      return;
    }
    setBookSelectedMessageIndex(null);
    setBookChatLoading(true);
    setBookLoadingRole("scholar");
    try {
      const response = await fetchBookConversation("/api/book-learning/scholar-answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: bookSessionId,
          teacherText: selectedMessage.text,
          subject: selectedResource.subject,
          resourceTitle: selectedResource.title,
          segmentTitle: selectedChapter.title,
          chapterText: selectedChapter.text,
          level: bookTeachingLevel ?? undefined,
          modelMode: bookModelMode,
          requestKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { reply?: string; error?: string; model?: string; sessionId?: number | null; usage?: BookUsage };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "AI 學霸暫時無法回答老師的問題");
      setBookSessionId(result.sessionId ?? bookSessionId);
      const scholarMessage: TutorMessage = {
        role: "scholar",
        text: result.reply!,
        model: result.model,
        usage: result.usage,
      };
      const messagesAfterScholar = [...bookMessages, scholarMessage].slice(-12);
      setBookMessages(messagesAfterScholar);

      // 學霸回答完成後，立即由 AI 導師針對這個回答給回饋，不能再要求
      // 使用者按第二次送出。學霸訊息以 scholar 身分傳給導師，並由 API
      // 只保存導師回饋，不重複保存一筆假的學生訊息。
      setBookLoadingRole("mentor");
      setBookTestNotice("AI 學霸已回答，AI 導師正在立即回饋…");
      try {
        const feedbackResponse = await fetchBookConversation("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: messagesAfterScholar.map(({ role, text }) => ({ role, text })),
            visibleStudentText: "",
            persistStudentMessage: false,
            teacherFeedback: true,
            sessionId: result.sessionId ?? bookSessionId,
            context: {
              type: "book",
              resourceId: selectedResource.id,
              segmentId: selectedChapter.id,
              resourceTitle: selectedResource.title,
              segmentTitle: selectedChapter.title,
            },
            modelMode: bookModelMode,
            teachingLevel: bookTeachingLevel ?? undefined,
          }),
        });
        const feedback = await feedbackResponse.json() as {
          reply?: string;
          error?: string;
          sessionId?: number;
          usage?: BookUsage;
          comparison?: BookComparison | null;
          teachingEvidence?: TeachingEvidence | null;
        };
        setBookSessionId(feedback.sessionId ?? result.sessionId ?? bookSessionId);
      setBookMessages((current) => [...current, {
          role: "mentor",
          text: feedbackResponse.ok ? (feedback.reply ?? "我先針對剛才的回答給你回饋。") : (feedback.error ?? "AI 導師暫時無法回饋這次回答"),
          model: feedback.usage?.model,
          usage: feedback.usage,
          comparison: feedback.comparison ?? undefined,
          teachingEvidence: feedbackResponse.ok ? feedback.teachingEvidence ?? null : null,
        }].slice(-12));
      void loadBookHistory(selectedResource.id);
      } catch {
        setBookMessages((current) => [...current, {
          role: "mentor",
          text: "AI 學霸已完成回答，但 AI 導師的即時回饋逾時；請稍後再送出一次。",
        }].slice(-12));
      }
      setBookTestNotice("");
    } catch (error) {
      setBookMessages((current) => [...current, { role: "scholar", text: error instanceof Error ? error.message : "AI 學霸暫時無法回答老師的問題" }].slice(-12));
    } finally {
      setBookChatLoading(false);
      setBookLoadingRole(null);
    }
  }

  async function submitBookMessage(directedText?: string) {
    const text = (directedText ?? bookInput).trim();
    if (!selectedChapter || !selectedResource || bookChatLoading) return;
    // 留白送出時，直接複用「老師問題 → 學霸回答」流程；只有學生自行輸入文字時，才走一般教材對話。
    if (!text) {
      await answerBookTeacherMessage();
      return;
    }
    const selectedMessage =
      bookSelectedMessageIndex !== null &&
      bookMessages[bookSelectedMessageIndex]?.role === "mentor"
        ? bookMessages[bookSelectedMessageIndex]
        : null;
    const studentMessage = { role: "student" as const, text };
    const nextMessages = [...bookMessages, studentMessage].slice(-12);
    setBookMessages(nextMessages);
    setBookInput("");
    setBookSelectedMessageIndex(null);
    setBookChatLoading(true);
    setBookLoadingRole("mentor");
    setBookTestNotice("學生回答已送出，AI 導師正在立即回饋…");
    try {
      const apiMessages = nextMessages.map((message, index) =>
        index === nextMessages.length - 1 && message.role === "student"
          ? {
              ...message,
              text: `${bookContext(selectedChapter)}${selectedMessage ? `\n\n【指定回覆】請直接承接下列較早的 AI 導師訊息，回應學生這次的內容；不要顯示「選取內容」或內部處理文字。\n${selectedMessage.text.slice(0, 6000)}` : ""}\n學生回覆：${message.text}`,
            }
          : message,
      );
      const response = await fetchBookConversation("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          visibleStudentText: text,
          sessionId: bookSessionId,
          context: {
            type: "book",
            resourceId: selectedResource.id,
            segmentId: selectedChapter.id,
            resourceTitle: selectedResource.title,
            segmentTitle: selectedChapter.title,
          },
          modelMode: bookModelMode,
          teachingLevel: bookTeachingLevel ?? undefined,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
        sessionId?: number;
        usage?: BookUsage;
        comparison?: BookComparison | null;
        teachingEvidence?: TeachingEvidence | null;
      };
      setBookSessionId(result.sessionId ?? bookSessionId);
      setBookMessages((current) => [
        ...current,
        {
          role: "mentor",
          text: response.ok
            ? (result.reply ?? "我們接著往下釐清。")
            : (result.error ?? "AI 教學暫時無法回應"),
          model: result.usage?.model,
          usage: result.usage,
          comparison: result.comparison ?? undefined,
          teachingEvidence: response.ok ? result.teachingEvidence ?? null : null,
        },
      ]);
      void loadBookHistory(selectedResource.id);
      setBookTestNotice("");
    } catch {
      setBookMessages((current) => [
        ...current,
        { role: "mentor", text: "這次回覆沒有送出成功，請再試一次。" },
      ]);
    } finally {
      setBookChatLoading(false);
      setBookLoadingRole(null);
    }
  }

  async function sendBookMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.querySelector("textarea")?.blur();
    await submitBookMessage();
  }

  function prepareBookLevelQuestion(level: "beginner" | "intermediate" | "advanced" | "super") {
    setBookTeachingLevel(level);
    saveBookAiSettings({ teachingLevel: level });
    setBookInput("");
    setBookTestNotice(`已設定為${bookTeachingLevelLabels[level]}；按「送出訊息」後，AI 學霸會直接回答老師的問題。`);
  }

  function captureMagazineSelection() {
    const text =
      window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (text.length >= 2) setMagazineSelectedText(text.slice(0, 1500));
  }

  function useMagazineSelection() {
    if (!magazineSelectedText) return;
    setMagazineInput(
      `請用白話解釋這段文字，並說明它在司律考試可能涉及的爭點：\n「${magazineSelectedText}」`,
    );
    window.setTimeout(() => magazineInputRef.current?.focus(), 0);
  }

  async function sendMagazineMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = magazineInput.trim();
    if (!question || !selectedMagazine || magazineAiLoading) return;
    const nextMessages: TutorMessage[] = [
      ...magazineMessages,
      { role: "student" as const, text: question },
    ].slice(-12);
    setMagazineMessages(nextMessages);
    setMagazineInput("");
    setMagazineSelectedText("");
    setMagazineAiLoading(true);
    setMagazineAiNotice("");
    const articleContext = (selectedMagazine.articles ?? [])
      .map(
        (article) =>
          `文章：${article.title}\n摘要：${article.summary || "未提供"}\n核心爭點：${article.issue || "未提供"}`,
      )
      .join("\n\n");
    const apiMessages = nextMessages.map((message, index) =>
      index === nextMessages.length - 1 && message.role === "student"
        ? {
            ...message,
            text: `目前期數：${selectedMagazine.title}\n本期可用試讀資料：\n${articleContext.slice(0, 10000)}\n\n學生問題：${message.text}`,
          }
        : message,
    );
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          visibleStudentText: question,
          sessionId: magazineSessionId,
          context: {
            type: "magazine",
            resourceId: selectedMagazine.id,
            resourceTitle: selectedMagazine.title,
          },
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
        sessionId?: number;
      };
      if (!response.ok || !result.reply)
        throw new Error(result.error || "AI 暫時無法回應");
      setMagazineSessionId(result.sessionId ?? magazineSessionId);
      setMagazineMessages((current) => [
        ...current,
        { role: "mentor", text: result.reply! },
      ]);
    } catch (error) {
      setMagazineAiNotice(
        error instanceof Error ? error.message : "AI 暫時無法回應",
      );
    } finally {
      setMagazineAiLoading(false);
    }
  }

  async function addRecord() {
    if (!recordDraft.title.trim()) return;
    const response = await fetch("/api/learning-records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...recordDraft, activityType: "手動補登" }),
    });
    if (!response.ok) return;
    const result = (await response.json()) as { record: StudyRecord };
    setRecords((current) => [result.record, ...current]);
    setLearningAnalysis((current) => current ? { ...current, isStale: true } : null);
    setLearningAnalysisNotice("已保存上次診斷；新增紀錄後，請重新分析目前學習狀況。");
    setRecordDraft({
      subject: "刑法",
      title: "",
      actualMinutes: 60,
      weakness: "",
      nextStep: "",
    });
    setRecordPage(1);
  }

  function toggleRecord(id: number) {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleRecordDetails(id: number) {
    setExpandedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisibleRecords() {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (allVisibleRecordsSelected) visibleRecordIds.forEach((id) => next.delete(id));
      else visibleRecordIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function deleteSelectedRecords() {
    const ids = [...selectedRecordIds];
    if (!ids.length || !window.confirm(`確定要刪除選取的 ${ids.length} 筆學習紀錄嗎？刪除後無法復原。`)) return;
    setDeletingRecords(true);
    setMessage("");
    try {
      const response = await fetch("/api/learning-records", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "學習紀錄刪除失敗");
      setRecords((current) => current.filter((record) => !selectedRecordIds.has(record.id)));
      setSelectedRecordIds(new Set());
      setRecordPage((current) => Math.min(current, Math.max(1, Math.ceil((records.length - ids.length) / 10))));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "學習紀錄刪除失敗");
    } finally {
      setDeletingRecords(false);
    }
  }

  async function analyzeLearning() {
    setLearningAnalysisLoading(true);
    setLearningAnalysisNotice("");
    try {
      const response = await fetch("/api/learning-analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const result = (await response.json()) as LearningAnalysis & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "AI 教練診斷暫時無法完成");
      setLearningAnalysis(result);
    } catch (error) {
      setLearningAnalysisNotice(error instanceof Error ? error.message : "AI 教練診斷暫時無法完成");
    } finally {
      setLearningAnalysisLoading(false);
    }
  }

  function openLearningRecommendation(recommendation: LearningAnalysisRecommendation) {
    if (recommendation.resourceId) setSelectedResourceId(recommendation.resourceId);
    if (recommendation.segmentId) {
      setSelectedSegmentId(recommendation.segmentId);
      setSelectedChapterId(recommendation.segmentId);
    }
    setActiveTab(recommendation.type === "影音課" ? "courses" : "books");
  }

  async function saveNote() {
    if (!noteDraft) return;
    const response = await fetch("/api/notes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...noteDraft, category: "law" }),
    });
    if (!response.ok) return;
    setNotes((current) =>
      current.map((note) =>
        note.id === noteDraft.id
          ? { ...noteDraft, updatedAt: new Date().toISOString() }
          : note,
      ),
    );
    setNoteDraft(null);
  }

  async function uploadStudentSummary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("summary-file") as HTMLInputElement | null;
    const file = summarySelectedFile ?? input?.files?.[0];
    if (!file) { setSummaryNotice("請先選擇檔案，或直接在這裡貼上截圖。 "); return; }
    setSummaryUploadLoading(true);
    setSummaryNotice("正在上傳原始資料…");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("subject", summarySubject);
      body.set("topic", summaryTopic);
      const upload = await fetch("/api/summaries", { method: "POST", body });
      const uploaded = await upload.json() as { summary?: StudentSummary; error?: string };
      if (!upload.ok || !uploaded.summary) throw new Error(uploaded.error ?? "上傳失敗");
      setStudentSummaries((current) => [uploaded.summary!, ...current]);
      setSelectedSummaryId(uploaded.summary.id);
      setSummaryPane("summary");
      setSummaryDraft(uploaded.summary.editedSummary || uploaded.summary.summary);
      setSummaryFavorite(uploaded.summary.favorite);
      setSummaryTitleDraft(uploaded.summary.displayTitle || uploaded.summary.name);
      setSummaryCollectionTitle(uploaded.summary.collectionTitle || uploaded.summary.topic || uploaded.summary.displayTitle || "");
      setSummaryNotice("已上傳，Luna 正在整理精簡摘要…");
      const process = await fetch("/api/summaries/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: uploaded.summary.id, fields: summaryFields, customFields: summaryCustomFields }) });
      const processed = await process.json() as { error?: string };
      if (!process.ok) throw new Error(processed.error ?? "AI 整理失敗，原始檔案已保留");
      const refreshed = await fetch("/api/summaries");
      if (refreshed.ok) setStudentSummaries(((await refreshed.json()) as { summaries?: StudentSummary[] }).summaries ?? []);
      setSummaryNotice("已完成整理；請核對原文與 AI 摘要後再收藏。");
      setSummarySelectedFile(null);
      form.reset();
    } catch (error) {
      setSummaryNotice(error instanceof Error ? error.message : "上傳或整理失敗");
    } finally {
      setSummaryUploadLoading(false);
    }
  }

  async function copySummaryReviewPack(item: StudentSummary) {
    const pack = `【司律備考｜整摘要模型評測】\n檔案：${item.name}\n科目：${item.subject}\n模型：${item.model}\n摘要欄位：${summaryFields.join("、")}\n自訂欄位：${summaryCustomFields.join("、") || "無"}\nToken：${(item.usage?.inputTokens ?? 0) + (item.usage?.outputTokens ?? 0)}\n成本：US$ ${(item.usage?.estimatedCostUsd ?? 0).toFixed(5)}\n\n【模型產出】\n${item.editedSummary || item.summary}\n\n考試整理：${item.examFocus}\n重點：${item.keyPoints.join("；")}\n重要爭點：${item.issueOutline.join("；")}\n常見錯誤：${item.commonMistakes.join("；")}\n來源位置：${item.sourceNotes.join("；")}\n\n請評測內容忠實度、重點完整度、法律考試實用性、結構與可讀性，並指出遺漏、錯誤及是否適合設為預設模型。`;
    await navigator.clipboard.writeText(pack); setSummaryNotice("已複製評測包；直接貼到這個 ChatGPT 對話，我會替你評測，不會產生網站內的評審模型成本。");
  }

  function handleSummaryPaste(event: ClipboardEvent<HTMLFormElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
    const image = imageItem?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    setSummarySelectedFile(new File([image], `貼上的截圖-${new Date().toISOString().slice(0, 10)}.${extension}`, { type: image.type || "image/png" }));
    setSummaryNotice("已貼上截圖；確認科目與模型後，按「上傳並整理」。");
  }

  function openStudentSummary(item: StudentSummary) {
    setSelectedSummaryId(item.id);
    setSummaryDraft(item.editedSummary || item.summary);
    setSummaryFavorite(item.favorite);
    setSummaryTitleDraft(item.displayTitle || item.name);
    setSummaryTopic(item.topic || "");
    setSummaryCollectionTitle(item.collectionTitle || item.topic || item.displayTitle || "");
    setSummaryFontSize([16, 18, 20, 22, 24].includes(item.fontSize ?? 20) ? item.fontSize ?? 20 : 20);
    setSummaryPane("summary");
  }

  function toggleSummaryFieldGroup(fields: readonly string[]) {
    setSummaryFields((current) => {
      const selected = fields.every((field) => current.includes(field));
      return selected
        ? current.filter((field) => !fields.includes(field))
        : [...new Set([...current, ...fields])];
    });
  }

  async function saveSummaryFolders(folders: SummaryFolder[]) {
    const response = await fetch("/api/summaries/folders", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ folders }) });
    const result = await response.json() as { folders?: SummaryFolder[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "資料夾保存失敗");
    setSummaryFolders(result.folders ?? folders);
  }

  async function addSummaryFolder() {
    const name = summaryFolderDraft.trim();
    if (!name) return;
    const next = [...summaryFolders, { subject: summaryFolderSubject, name }];
    try { await saveSummaryFolders(next); setSummaryFolderDraft(""); setSummaryDestination(`${summaryFolderSubject}::${name}`); setSummaryNotice(`已在${summaryFolderSubject}新增「${name}」。`); }
    catch (error) { setSummaryNotice(error instanceof Error ? error.message : "資料夾保存失敗"); }
  }

  async function renameSummaryFolder(subject: string, oldName: string) {
    const name = editingSummaryFolderName.trim();
    if (!name) { setSummaryNotice("資料夾名稱不能空白。"); return; }
    if (name === oldName) { setEditingSummaryFolder(null); return; }
    if (summaryFolders.some((folder) => folder.subject === subject && folder.name === name)) {
      setSummaryNotice(`「${name}」已存在於${subject}，請使用其他名稱。`);
      return;
    }
    setSummarySaving(true);
    try {
      const affected = studentSummaries.filter((item) => item.subject === subject && (item.folder || "未分類") === oldName);
      const updated = await Promise.all(affected.map(async (item) => {
        const response = await fetch("/api/summaries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, subject, folder: name }) });
        const result = await response.json() as { summary?: StudentSummary; error?: string };
        if (!response.ok || !result.summary) throw new Error(result.error ?? "資料歸屬更新失敗");
        return result.summary;
      }));
      await saveSummaryFolders(summaryFolders.map((folder) => folder.subject === subject && folder.name === oldName ? { ...folder, name } : folder));
      const byId = new Map(updated.map((item) => [item.id, item]));
      setStudentSummaries((items) => items.map((item) => byId.get(item.id) ?? item));
      if (summaryDestination === `${subject}::${oldName}`) setSummaryDestination(`${subject}::${name}`);
      setEditingSummaryFolder(null);
      setEditingSummaryFolderName("");
      setSummaryNotice(`已將${subject}／「${oldName}」改名為「${name}」。`);
    } catch (error) { setSummaryNotice(error instanceof Error ? error.message : "資料夾改名失敗"); }
    finally { setSummarySaving(false); }
  }

  async function moveSelectedSummaries() {
    const [subject, folder] = summaryDestination.split("::");
    const ids = [...selectedSummaryIds];
    if (!subject || !folder || !ids.length) { setSummaryNotice("請先勾選資料並選擇目的資料夾。"); return; }
    setSummarySaving(true);
    try {
      const updated = await Promise.all(ids.map(async (id) => {
        const response = await fetch("/api/summaries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, subject, folder }) });
        const result = await response.json() as { summary?: StudentSummary; error?: string };
        if (!response.ok || !result.summary) throw new Error(result.error ?? "移動失敗");
        return result.summary;
      }));
      const byId = new Map(updated.map((item) => [item.id, item]));
      setStudentSummaries((items) => items.map((item) => byId.get(item.id) ?? item));
      setSelectedSummaryIds(new Set());
      setSummaryNotice(`已將 ${ids.length} 份資料移到${subject}／${folder}。`);
    } catch (error) { setSummaryNotice(error instanceof Error ? error.message : "移動失敗"); }
    finally { setSummarySaving(false); }
  }

  function toggleSummarySelection(id: number) {
    setSelectedSummaryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllSummaries() {
    setSelectedSummaryIds((current) =>
      studentSummaries.length > 0 && studentSummaries.every((item) => current.has(item.id))
        ? new Set()
        : new Set(studentSummaries.map((item) => item.id)),
    );
  }

  async function deleteSelectedSummaries() {
    const ids = [...selectedSummaryIds];
    if (!ids.length || !window.confirm(`確定要刪除選取的 ${ids.length} 份摘要嗎？原始檔案與整理結果都會刪除，且無法復原。`)) return;
    setSummaryDeleting(true);
    setSummaryNotice("正在刪除選取的摘要…");
    try {
      const response = await fetch("/api/summaries", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await response.json() as { deletedIds?: number[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "摘要刪除失敗");
      const deletedIds = new Set(result.deletedIds ?? ids);
      const remaining = studentSummaries.filter((item) => !deletedIds.has(item.id));
      setStudentSummaries(remaining);
      setSelectedSummaryIds(new Set());
      const nextSelected = selectedSummaryId !== null && !deletedIds.has(selectedSummaryId)
        ? remaining.find((item) => item.id === selectedSummaryId)
        : undefined;
      setSelectedSummaryId(nextSelected?.id ?? null);
      setSummaryDraft(nextSelected ? nextSelected.editedSummary || nextSelected.summary : "");
      setSummaryFavorite(nextSelected?.favorite ?? false);
      setSummaryNotice(`已刪除 ${deletedIds.size} 份摘要。`);
    } catch (error) {
      setSummaryNotice(error instanceof Error ? error.message : "摘要刪除失敗");
    } finally {
      setSummaryDeleting(false);
    }
  }

  async function saveStudentSummary() {
    const item = studentSummaries.find((summary) => summary.id === selectedSummaryId);
    if (!item) return;
    setSummarySaving(true);
    try {
      const response = await fetch("/api/summaries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, editedSummary: summaryDraft, favorite: summaryFavorite, tags: item.tags, title: summaryTitleDraft, topic: summaryTopic, collectionTitle: summaryCollectionTitle, folder: item.folder || "未分類", fontSize: summaryFontSize }) });
      const result = await response.json() as { summary?: StudentSummary; error?: string };
      if (!response.ok || !result.summary) throw new Error(result.error ?? "摘要保存失敗");
      setStudentSummaries((current) => current.map((summary) => summary.id === item.id ? result.summary! : summary));
      setSummaryNotice("摘要已保存。");
    } catch (error) {
      setSummaryNotice(error instanceof Error ? error.message : "摘要保存失敗");
    } finally {
      setSummarySaving(false);
    }
  }

  async function addBlankNote() {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "未命名筆記",
        content: "",
        subject: "綜合",
        sourceType: "manual",
        category: "law",
      }),
    });
    if (!response.ok) return;
    const result = (await response.json()) as { note: SavedNote };
    setNotes((current) => [result.note, ...current]);
    setNoteDraft(result.note);
  }

  async function removeNote() {
    if (!noteDraft || !window.confirm(`確定刪除「${noteDraft.title}」？`))
      return;
    const response = await fetch(`/api/notes?id=${noteDraft.id}&category=law`, {
      method: "DELETE",
    });
    if (response.ok) {
      setNotes((current) => current.filter((note) => note.id !== noteDraft.id));
      setNoteDraft(null);
    }
  }

  async function addMyCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMyCourseMessage("");
    setMyCourseJudgement(null);
    setMyCourseLoading(true);
    try {
      const response = await fetch("/api/my-courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: myCourseUrl, title: myCourseTitle, subject: myCourseSubject, examType: myCourseExamType, scope: myCourseScope }),
      });
      const result = (await response.json()) as { course?: MyCourse; judgement?: { label: string; score: number; reason: string }; error?: string };
      if (!response.ok || !result.course) throw new Error(result.error ?? "目前無法加入我的課");
      setMyCourses((current) => [result.course!, ...current]);
      setSelectedMyCourseId(result.course.id);
      setMyCourseJudgement(result.judgement ?? null);
      setMyCourseMessage("已加入我的課，這堂課只會出現在你的學習專區。");
      setMyCourseUrl("");
      setMyCourseTitle("");
    } catch (error) {
      setMyCourseMessage(error instanceof Error ? error.message : "目前無法加入我的課");
    } finally {
      setMyCourseLoading(false);
    }
  }

  async function removeMyCourse(course: MyCourse) {
    if (!window.confirm(`確定要從我的課移除「${course.title}」？`)) return;
    const response = await fetch(`/api/my-courses?id=${course.id}`, { method: "DELETE" });
    if (!response.ok) return;
    setMyCourses((current) => current.filter((item) => item.id !== course.id));
    setSelectedMyCourseId((current) => current === course.id ? null : current);
  }

  function resetMyCourseAiDraft() {
    setMyCourseScreenshotDataUrl("");
    setMyCourseScreenshotName("");
    setMyCourseChatMessages([]);
    setMyCourseSessionId(null);
    setMyCourseAiReply("");
    setMyCourseAiNotice("");
    setMyCourseLastQuestion("");
    setMyCourseNoteMessage("");
  }

  function resetPublicCourseAiDraft() {
    setPublicCourseScreenshotDataUrl("");
    setPublicCourseScreenshotName("");
    setPublicCourseChatMessages([]);
    setPublicCourseSessionId(null);
    setPublicCourseAiReply("");
    setPublicCourseAiNotice("");
    setPublicCourseLastQuestion("");
    setPublicCourseNoteMessage("");
  }

  async function askMyCourseAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = myCourseAiInput.trim();
    if (!question || !selectedMyCourse || myCourseAiLoading) return;
    setMyCourseLastQuestion(question);
    setMyCourseAiLoading(true);
    setMyCourseAiReply("");
    setMyCourseAiNotice("");
    const episodeTitle = selectedMyEpisode?.title ?? "整個播放清單";
    const contextEpisodeId = courseEpisodeContextId(selectedMyEpisode?.videoId);
    const studentMessage: TutorMessage = { role: "student", text: question };
    const nextMessages = [...myCourseChatMessages, studentMessage].slice(-12);
    setMyCourseChatMessages(nextMessages);
    try {
      const apiMessages = nextMessages.map((message, index) => index === nextMessages.length - 1
        ? {
            ...message,
            text: `我的課程：${selectedMyCourse.title}；科目：${selectedMyCourse.subject}；目前單元：${episodeTitle}。這是學生自行貼上的 YouTube 課程，平台沒有影片字幕或逐字內容。${myCourseScreenshotDataUrl ? "學生另外提供了一張課程畫面截圖，請只依截圖中看得到的文字與畫面回答，不要假設你看過或聽過整支影片。" : "請只依學生自行輸入的問題與可靠的一般法律知識回答，不要假設你看過或聽過這支影片。"} 若問題涉及老師在影片中的特定說法，請指出需要學生補上老師原話、畫面文字或自己的聽課筆記。\n學生問題：${message.text}`,
          }
        : message);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          sessionId: myCourseSessionId,
          visibleStudentText: question,
          imageDataUrl: myCourseScreenshotDataUrl || undefined,
          context: {
            type: "my-course",
            resourceId: selectedMyCourse.id,
            episodeId: contextEpisodeId,
            resourceTitle: selectedMyCourse.title,
            episodeTitle,
          },
        }),
      });
      const result = (await response.json()) as { reply?: string; error?: string; sessionId?: number };
      if (!response.ok) throw new Error(result.error ?? "AI 暫時無法回應");
      setMyCourseSessionId(result.sessionId ?? myCourseSessionId);
      setMyCourseChatMessages((current) => [...current, { role: "mentor" as const, text: result.reply ?? "AI 尚未產生回答，請換一種問法再試一次。" }].slice(-12));
      setMyCourseAiReply(result.reply ?? "AI 尚未產生回答，請換一種問法再試一次。");
      setMyCourseAiInput("");
    } catch (error) {
      setMyCourseAiNotice(error instanceof Error ? error.message : "AI 暫時無法回應");
    } finally {
      setMyCourseAiLoading(false);
    }
  }

  function loadCourseScreenshotFile(
    file: File,
    onData: (dataUrl: string) => void,
    onName: (name: string) => void,
    onNotice: (notice: string) => void,
  ) {
    if (!file.type.startsWith("image/")) {
      onNotice("請選擇圖片格式的課程截圖。");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onNotice("截圖請控制在 8MB 以下。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          onNotice("截圖讀取失敗，請換一張圖片再試。");
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        onData(canvas.toDataURL("image/jpeg", 0.78));
        onName(file.name || "課程截圖.jpg");
        onNotice("截圖已加入；輸入問題後即可讓 AI 依畫面協助判斷。若是 YouTube 內嵌播放器，請用裝置截圖後在這裡貼上。 ");
      };
      image.onerror = () => onNotice("截圖讀取失敗，請換一張圖片再試。");
      image.src = String(reader.result ?? "");
    };
    reader.onerror = () => onNotice("截圖讀取失敗，請換一張圖片再試。");
    reader.readAsDataURL(file);
  }

  function loadMyCourseScreenshot(file: File) {
    loadCourseScreenshotFile(
      file,
      setMyCourseScreenshotDataUrl,
      setMyCourseScreenshotName,
      setMyCourseAiNotice,
    );
  }

  function handleScreenshotPaste(
    event: ClipboardEvent,
    onLoad: (file: File) => void,
  ) {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    onLoad(new File([image], `貼上的課程截圖-${Date.now()}.png`, { type: image.type }));
  }

  async function saveMyCourseScreenshotNote() {
    if (!selectedMyCourse || !myCourseScreenshotDataUrl) return;
    const episodeTitle = selectedMyEpisode?.title ?? "整個播放清單";
    const episodeKey = selectedMyEpisode?.videoId ?? "course";
    const content = `課程：${selectedMyCourse.title}\n單元：${episodeTitle}\n\n我的問題：${myCourseLastQuestion || myCourseAiInput.trim() || "尚未輸入問題"}\n\nAI 回答：${myCourseAiReply || "尚未取得 AI 回答"}`;
    setMyCourseNoteMessage("正在保存截圖筆記…");
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "law",
        sourceType: "my-course-screenshot",
        sourceId: `my-course:${selectedMyCourse.id}:${episodeKey}`,
        title: `${selectedMyCourse.title}｜${episodeTitle}`,
        content,
        subject: selectedMyCourse.subject,
        tags: "我的課、截圖、待複習",
        sourceLabel: `${selectedMyCourse.title}｜${episodeTitle}`,
        imageDataUrl: myCourseScreenshotDataUrl,
        imageSourceUrl: selectedMyCourse.sourceUrl,
        episodeTitle,
        positionSeconds: 0,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMyCourseNoteMessage(result.error ?? "截圖筆記保存失敗");
      return;
    }
    const notesResponse = await fetch("/api/notes?category=law");
    if (notesResponse.ok) setNotes(((await notesResponse.json()) as { notes?: SavedNote[] }).notes ?? []);
    setMyCourseNoteMessage("已保存到筆記收藏；下次可從筆記繼續複習。");
  }

  async function askPublicCourseAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = publicCourseAiInput.trim();
    if (!question || !selectedPublicCourse || publicCourseAiLoading) return;
    setPublicCourseLastQuestion(question);
    setPublicCourseAiLoading(true);
    setPublicCourseAiReply("");
    setPublicCourseAiNotice("");
    const episodeTitle = selectedPublicEpisode?.title ?? "整個播放清單";
    const contextEpisodeId = courseEpisodeContextId(selectedPublicEpisode?.videoId);
    const studentMessage: TutorMessage = { role: "student", text: question };
    const nextMessages = [...publicCourseChatMessages, studentMessage].slice(-12);
    setPublicCourseChatMessages(nextMessages);
    try {
      const apiMessages = nextMessages.map((message, index) => index === nextMessages.length - 1
        ? {
            ...message,
            text: `開放課程：${selectedPublicCourse.title}；科目：${selectedPublicCourse.subject}；目前單元：${episodeTitle}。這是平台整理的 YouTube 公開課程，平台沒有影片逐字稿。${publicCourseScreenshotDataUrl ? "學生提供了一張目前課程畫面截圖，請只依截圖中看得到的文字與畫面回答。" : "請只依學生輸入的問題與可靠的一般法律知識回答，不要假設你看過或聽過影片。"} 若問題涉及老師口頭說法，請指出需要學生補上老師原話或聽課筆記。\n學生問題：${message.text}`,
          }
        : message);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          sessionId: publicCourseSessionId,
          visibleStudentText: question,
          imageDataUrl: publicCourseScreenshotDataUrl || undefined,
          context: {
            type: "public-course",
            resourceId: selectedPublicCourse.id,
            episodeId: contextEpisodeId,
            resourceTitle: selectedPublicCourse.title,
            episodeTitle,
          },
        }),
      });
      const result = (await response.json()) as { reply?: string; error?: string; sessionId?: number };
      if (!response.ok) throw new Error(result.error ?? "AI 暫時無法回應");
      setPublicCourseSessionId(result.sessionId ?? publicCourseSessionId);
      setPublicCourseChatMessages((current) => [...current, { role: "mentor" as const, text: result.reply ?? "AI 尚未產生回答，請換一種問法再試一次。" }].slice(-12));
      setPublicCourseAiReply(result.reply ?? "AI 尚未產生回答，請換一種問法再試一次。");
      setPublicCourseAiInput("");
    } catch (error) {
      setPublicCourseAiNotice(error instanceof Error ? error.message : "AI 暫時無法回應");
    } finally {
      setPublicCourseAiLoading(false);
    }
  }

  async function savePublicCourseScreenshotNote() {
    if (!selectedPublicCourse || !publicCourseScreenshotDataUrl) return;
    const episodeTitle = selectedPublicEpisode?.title ?? "整個播放清單";
    const episodeKey = selectedPublicEpisode?.videoId ?? "course";
    const content = `課程：${selectedPublicCourse.title}\n單元：${episodeTitle}\n\n我的問題：${publicCourseLastQuestion || publicCourseAiInput.trim() || "尚未輸入問題"}\n\nAI 回答：${publicCourseAiReply || "尚未取得 AI 回答"}`;
    setPublicCourseNoteMessage("正在保存截圖筆記…");
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "law",
        sourceType: "public-course-screenshot",
        sourceId: `public-course:${selectedPublicCourse.id}:${episodeKey}`,
        title: `${selectedPublicCourse.title}｜${episodeTitle}`,
        content,
        subject: selectedPublicCourse.subject,
        tags: "開放課、截圖、待複習",
        sourceLabel: `${selectedPublicCourse.title}｜${episodeTitle}`,
        imageDataUrl: publicCourseScreenshotDataUrl,
        imageSourceUrl: selectedPublicCourse.sourceUrl,
        episodeTitle,
        positionSeconds: 0,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setPublicCourseNoteMessage(result.error ?? "截圖筆記保存失敗");
      return;
    }
    const notesResponse = await fetch("/api/notes?category=law");
    if (notesResponse.ok) setNotes(((await notesResponse.json()) as { notes?: SavedNote[] }).notes ?? []);
    setPublicCourseNoteMessage("已保存；筆記會留在這一集影片下方，也可到筆記收藏查看。");
  }

  return (
    <main className={standalone ? "essay-standalone-page standalone-learning-page" : "plan-shell"}>
      <header className={standalone ? "essay-standalone-header" : "topbar"}>
        <a href="/law" className="brand">
          <span className={standalone ? "" : "brand-mark"}>{standalone ? "司" : "律"}</span>
          {standalone ? <b>司律備考</b> : <span>司律備考</span>}
        </a>
        {standalone ? <nav aria-label="獨立學習頁導覽"><a href="/law" aria-label="回到司律備考首頁">← 回首頁</a></nav> : <div className="top-actions"><a href="/law" className="back-link">返回對話</a><a href="/admin" className="admin-link">管理後台</a></div>}
      </header>
      <div className="plan-main">
        {standalone && activeTab === "calendar" && <div className="standalone-calendar-heading">
          <div>
            <p>MY CALENDAR</p>
            <h1>我的行事曆</h1>
            <span>查看每天的讀書安排、完成進度與待辦任務。</span>
          </div>
          <div className="calendar-header-actions">
            <button className="reset-plan-btn" onClick={openResetPlanner}>↻ AI 重新規劃</button>
            <button className="add-task" onClick={() => openNew()}>＋ 新增任務</button>
          </div>
        </div>}
        {!standalone && <div className="plan-header">
          <div>
            <p>MY LEARNING CENTER</p>
            <h1>學習專區</h1>
            <span>
              {plans[0]
                ? `${plans[0].targetLabel} · 每日 ${plans[0].dailyMinutes} 分鐘`
                : "和司律備考聊完後，AI 會把任務寫到這裡"}
            </span>
          </div>
          {activeTab === "calendar" && (
            <div className="calendar-header-actions">
              <button className="reset-plan-btn" onClick={openResetPlanner}>
                ↻ AI 重新規劃
              </button>
              <button className="add-task" onClick={() => openNew()}>
                ＋ 新增任務
              </button>
            </div>
          )}
        </div>}
        {!standalone && <nav className="plan-tabs">
          <button
            className={activeTab === "calendar" ? "active" : ""}
            onClick={() => setActiveTab("calendar")}
          >
            行事曆
          </button>
          <button
            className={activeTab === "practice" ? "active" : ""}
            onClick={() => setActiveTab("practice")}
          >
            練真題
          </button>
          <button
            className={activeTab === "hotspots" ? "active" : ""}
            onClick={() => setActiveTab("hotspots")}
          >
            找爭點
          </button>
          <button
            className={activeTab === "summaries" ? "active" : ""}
            onClick={() => setActiveTab("summaries")}
          >
            整摘要 <span>{studentSummaries.length}</span>
          </button>
          <a href="/study-group" className="plan-tab-link">AI 讀書會</a>
          <button
            className={activeTab === "books" ? "active" : ""}
            onClick={() => setActiveTab("books")}
          >
            智能書
          </button>
          <button
            className={activeTab === "courses" ? "active" : ""}
            onClick={() => setActiveTab("courses")}
          >
            來一課
          </button>
          <button
            className={activeTab === "public-courses" ? "active" : ""}
            onClick={() => setActiveTab("public-courses")}
          >
            開放課
          </button>
          <button
            className={activeTab === "my-courses" ? "active" : ""}
            onClick={() => setActiveTab("my-courses")}
          >
            我的課 <span>{myCourses.length}</span>
          </button>
          <button
            className={activeTab === "laws" ? "active" : ""}
            onClick={() => setActiveTab("laws")}
          >
            尋法脈
          </button>
          <button
            className={activeTab === "listening" ? "active" : ""}
            onClick={() => setActiveTab("listening")}
          >
            聽解題
          </button>
          <button
            className={activeTab === "magazine" ? "active" : ""}
            onClick={() => setActiveTab("magazine")}
          >
            讀法教
          </button>
          <button
            className={activeTab === "records" ? "active" : ""}
            onClick={() => setActiveTab("records")}
          >
            學習紀錄 <span>{records.length}</span>
          </button>
          <button
            className={activeTab === "conversations" ? "active" : ""}
            onClick={() => setActiveTab("conversations")}
          >
            每日對話 <span>{chatDays.length}</span>
          </button>
          <button
            className={activeTab === "exam-conversations" ? "active" : ""}
            onClick={() => setActiveTab("exam-conversations")}
          >
            試題問答 <span>{examConversations.length}</span>
          </button>
          <a href="/notes" className="plan-tab-link">我的筆記 <span>{notes.length}</span></a>
        </nav>}
        {activeTab === "summaries" && (
          <section className="student-summary-hub" aria-label="整摘要">
            <header className="student-summary-head">
              <div>
                <p>STUDY MATERIAL ORGANIZER</p>
                <h2>整摘要</h2>
                <span>上傳照片或檔案，整理成可核對、可編輯、可收藏的學習資料。</span>
              </div>
              <div className="student-summary-controls">
                <label>科目<select value={summarySubject} onChange={(event) => setSummarySubject(event.target.value)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
                <label>分類主題<input value={summaryTopic} maxLength={120} onChange={(event) => setSummaryTopic(event.target.value)} placeholder="例如：不作為犯／遺產稅" /></label>
              </div>
            </header>
            <form className="student-summary-upload" onSubmit={uploadStudentSummary} onPaste={handleSummaryPaste}>
              <label className="student-summary-dropzone" tabIndex={0}>
                <strong>拍照／選擇檔案／貼上截圖</strong>
                <span>PDF、PNG、JPG、WEBP、TXT、JSONL；單檔最多 25MB。也可以按 Ctrl/Cmd+V 直接貼上截圖。</span>
                {summarySelectedFile && <small className="student-summary-selected-file">已選取：{summarySelectedFile.name}</small>}
                <input name="summary-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.jsonl,application/pdf,image/png,image/jpeg,image/webp,text/plain,application/jsonl" onChange={(event) => setSummarySelectedFile(event.target.files?.[0] ?? null)} />
              </label>
              <button type="submit" disabled={summaryUploadLoading}>{summaryUploadLoading ? "整理中…" : "上傳並整理"}</button>
            </form>
            {summaryNotice && <p className="student-summary-notice">{summaryNotice}</p>}
            <nav className="student-summary-pane-tabs" role="tablist" aria-label="摘要與整理資料切換">
              <button type="button" role="tab" aria-selected={summaryPane === "files"} className={summaryPane === "files" ? "active" : ""} onClick={() => setSummaryPane("files")}>整理資料 <span>{studentSummaries.length}</span></button>
              <button type="button" role="tab" aria-selected={summaryPane === "summary"} className={summaryPane === "summary" ? "active" : ""} onClick={() => setSummaryPane("summary")}>摘要</button>
            </nav>
            <div className="student-summary-layout">
              <aside className={`student-summary-list ${summaryPane === "files" ? "mobile-summary-active" : "mobile-summary-hidden"}`} role="tabpanel" aria-label="我的整理資料">
                <div className="student-summary-list-head">
                  <div><strong>我的整理資料</strong><span>{studentSummaries.length} 份</span></div>
                  {studentSummaries.length > 0 && <label className="student-summary-select-all"><input type="checkbox" checked={studentSummaries.every((item) => selectedSummaryIds.has(item.id))} onChange={toggleAllSummaries} aria-label="全選摘要" />全選</label>}
                </div>
                <div className="student-summary-folder-create">
                  <select value={summaryFolderSubject} onChange={(event) => setSummaryFolderSubject(event.target.value)} aria-label="資料夾所屬科目">{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>
                  <input value={summaryFolderDraft} onChange={(event) => setSummaryFolderDraft(event.target.value)} placeholder="新增自訂資料夾" maxLength={80} />
                  <button type="button" onClick={() => void addSummaryFolder()} disabled={!summaryFolderDraft.trim()}>＋</button>
                </div>
                {studentSummaries.length > 0 && <div className="student-summary-bulkbar student-summary-movebar"><span>已選 {selectedSummaryIds.size} 份</span><select value={summaryDestination} onChange={(event) => setSummaryDestination(event.target.value)} aria-label="移動到資料夾"><option value="">移動到…</option>{summaryFolders.map((folder) => <option key={`${folder.subject}-${folder.name}`} value={`${folder.subject}::${folder.name}`}>{folder.subject}／{folder.name}</option>)}</select><button type="button" onClick={() => void moveSelectedSummaries()} disabled={selectedSummaryIds.size === 0 || !summaryDestination || summarySaving}>移動</button><button type="button" onClick={() => void deleteSelectedSummaries()} disabled={selectedSummaryIds.size === 0 || summaryDeleting}>{summaryDeleting ? "刪除中…" : "刪除"}</button></div>}
                {studentSummaries.length ? subjects.filter((subject) => studentSummaries.some((item) => item.subject === subject) || summaryFolders.some((folder) => folder.subject === subject)).map((subject) => (
                  <details className="student-summary-subject-group" key={subject} open>
                    <summary><span>▾ {subject}</span><small>{studentSummaries.filter((item) => item.subject === subject).length}</small></summary>
                    {["未分類", ...summaryFolders.filter((folder) => folder.subject === subject).map((folder) => folder.name)].map((folderName) => {
                      const folderItems = studentSummaries.filter((item) => item.subject === subject && (item.folder || "未分類") === folderName);
                      if (!folderItems.length && folderName === "未分類") return null;
                      const folderKey = `${subject}::${folderName}`;
                      const isEditingFolder = editingSummaryFolder === folderKey;
                      return <details className="student-summary-folder-group" key={`${subject}-${folderName}`} open={folderItems.length > 0 || isEditingFolder}>
                        <summary>
                          {isEditingFolder ? <span className="student-summary-folder-rename" onClick={(event) => event.preventDefault()}>
                            <input value={editingSummaryFolderName} onChange={(event) => setEditingSummaryFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void renameSummaryFolder(subject, folderName); } if (event.key === "Escape") setEditingSummaryFolder(null); }} maxLength={80} autoFocus aria-label="修改資料夾名稱" />
                            <button type="button" onClick={() => void renameSummaryFolder(subject, folderName)} disabled={!editingSummaryFolderName.trim() || summarySaving}>保存</button>
                            <button type="button" className="cancel" onClick={() => setEditingSummaryFolder(null)}>取消</button>
                          </span> : <span>📁 {folderName}</span>}
                          <span className="student-summary-folder-tools"><small>{folderItems.length}</small>{folderName !== "未分類" && !isEditingFolder && <button type="button" title="修改資料夾名稱" aria-label={`修改${folderName}資料夾名稱`} onClick={(event) => { event.preventDefault(); setEditingSummaryFolder(folderKey); setEditingSummaryFolderName(folderName); }}>✎</button>}</span>
                        </summary>
                        {folderItems.map((item) => <div className={`student-summary-row ${selectedSummaryId === item.id ? "active" : ""}`} key={item.id}>
                          <label className="student-summary-checkbox"><input type="checkbox" checked={selectedSummaryIds.has(item.id)} onChange={() => toggleSummarySelection(item.id)} aria-label={`選取 ${item.name}`} /></label>
                          <button type="button" className="student-summary-item" onClick={() => openStudentSummary(item)}><span>{item.favorite ? "★" : "☆"}</span><div><strong>{item.collectionTitle || item.displayTitle || item.name}</strong><small>{item.status === "completed" ? "已整理" : item.processingMessage || "處理中"}</small></div></button>
                        </div>)}
                      </details>;
                    })}
                  </details>
                )) : <div className="student-summary-empty">尚未上傳資料。先上傳一份講義或照片，這裡會保存整理紀錄。</div>}
              </aside>
              <section className={`student-summary-detail ${summaryPane === "summary" ? "mobile-summary-active" : "mobile-summary-hidden"}`} role="tabpanel" aria-live="polite">
                {(() => {
                  const item = studentSummaries.find((summary) => summary.id === selectedSummaryId);
                  if (!item) return <div className="student-summary-empty large">請從左側點選一份整理資料，這裡才會顯示內容。</div>;
                  return <>
                    <div className="student-summary-detail-head"><div className="student-summary-detail-title"><span>{item.subject} · 原始檔案：{item.name}</span><h3>{item.status === "completed" ? "整理完成，可編輯與收藏" : item.processingMessage}</h3><div className="student-summary-title-grid"><label className="student-summary-title-editor"><span>左側顯示標題</span><input value={summaryTitleDraft} maxLength={120} onChange={(event) => setSummaryTitleDraft(event.target.value)} placeholder="例如：刑法鑑定制度重點" /></label><label className="student-summary-title-editor"><span>收藏主題</span><input value={summaryCollectionTitle} maxLength={120} onChange={(event) => setSummaryCollectionTitle(event.target.value)} placeholder="例如：刑事鑑定重要實務" /></label></div></div><div className="student-summary-detail-actions"><label className="student-summary-font-control"><span>摘要字級</span><select value={summaryFontSize} onChange={(event) => setSummaryFontSize(Number(event.target.value))}><option value={16}>小</option><option value={18}>標準</option><option value={20}>大</option><option value={22}>特大</option><option value={24}>超大</option></select></label><button type="button" className={summaryFavorite ? "favorite active" : "favorite"} onClick={() => setSummaryFavorite((value) => !value)}>{summaryFavorite ? "★ 已收藏" : "☆ 收藏摘要"}</button></div></div>
                    {item.status === "completed" ? <>
                      <label className="student-summary-editor"><span>我的摘要版本（可直接修改）</span><textarea style={{ fontSize: `${summaryFontSize}px` }} value={summaryDraft || item.editedSummary || item.summary} onChange={(event) => setSummaryDraft(event.target.value)} rows={10} /></label>
                      <details className="student-summary-supporting"><summary>查看考試補充</summary><div style={{ fontSize: `${summaryFontSize}px` }}><section><b>考點與爭點</b><p>{item.examFocus || "原檔未明確提供考試整理，請依原文核對。"}</p>{item.keyPoints.length > 0 && <ul>{item.keyPoints.map((point) => <li key={`point-${point}`}>{point}</li>)}</ul>}{item.issueOutline.length > 0 && <ul>{item.issueOutline.map((point) => <li key={`issue-${point}`}>{point}</li>)}</ul>}</section><section><b>常見錯誤</b>{item.commonMistakes.length ? <ul>{item.commonMistakes.map((point) => <li key={point}>{point}</li>)}</ul> : <p>原檔未明確提供常見錯誤。</p>}</section><section><b>來源依據</b>{item.sourceNotes.length ? <ul>{item.sourceNotes.map((point) => <li key={point}>{point}</li>)}</ul> : <p>原檔未明確提供來源位置。</p>}</section></div></details>
                      <details className="student-summary-flashcard-toggle"><summary>用複習卡自我測驗</summary>{item.flashcards.length > 0 ? <div className="student-summary-flashcards">{item.flashcards.slice(0, 6).map((card) => <details key={card.question}><summary>{card.question}</summary><p>{card.answer}</p></details>)}</div> : <p>目前沒有可用的複習卡。</p>}</details>
                      <footer className="student-summary-meta"><span>{item.model || "尚未使用模型"} · {(item.usage?.inputTokens ?? 0) + (item.usage?.outputTokens ?? 0)} tokens · 約 US$ {(item.usage?.estimatedCostUsd ?? 0).toFixed(4)} · 約 NT$ {formatTwd(item.usage?.estimatedCostUsd ?? 0)}</span><div><button type="button" onClick={() => void saveStudentSummary()} disabled={summarySaving}>{summarySaving ? "保存中…" : "保存標題、收藏主題與摘要"}</button></div></footer>
                    </> : <div className="student-summary-empty large">{item.error || item.processingMessage || "正在處理…"}</div>}
                  </>;
                })()}
              </section>
            </div>
          </section>
        )}
        {activeTab === "hotspots" && (
          <>
          <IssuePractice />
          {false && (<section className="hot-points-hub" aria-label="司律熱考點">
            <header className="hot-points-head">
              <div>
                <p>CORE EXAM POINTS</p>
                <h2>熱考點</h2>
                <span>
                  先依各科核心體系整理複習順序；刑法可直接銜接現有智能書學習。
                </span>
              </div>
              <aside>
                <strong>{coreExamPoints.length}</strong>
                <span>個核心考點</span>
              </aside>
            </header>
            <nav className="hot-subject-tabs" aria-label="熱考點科目篩選">
              {["全部", ...planningSubjects].map((subject) => (
                <button
                  type="button"
                  className={hotSubject === subject ? "active" : ""}
                  key={subject}
                  onClick={() => setHotSubject(subject)}
                >
                  {subject}
                </button>
              ))}
            </nav>
            <div className="hot-points-grid">
              {coreExamPoints
                .filter(
                  (point) =>
                    hotSubject === "全部" || point.subject === hotSubject,
                )
                .map((point, index) => {
                  const hasBook =
                    point.subject === "刑法" &&
                    bookResources.some(
                      (item) =>
                        item.subject === "刑法" || item.title.includes("刑法"),
                    );
                  return (
                    <article
                      className="hot-point-card"
                      key={`${point.subject}-${point.title}`}
                    >
                      <header>
                        <span>{point.subject}</span>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                      </header>
                      <div className="hot-point-badges">
                        <strong>{point.level}</strong>
                        {point.exams.map((exam) => (
                          <em key={exam}>{exam}</em>
                        ))}
                      </div>
                      <h3>{point.title}</h3>
                      <p>{point.summary}</p>
                      <div className="hot-point-cue">
                        <b>審題提醒</b>
                        <span>{point.cue}</span>
                      </div>
                      <div
                        className={`hot-point-source ${hasBook ? "available" : "pending"}`}
                      >
                        <b>{hasBook ? "已連結智能書" : "教材待上架"}</b>
                        <span>
                          {hasBook
                            ? "依考點定位刑法章節"
                            : "目前尚無本科智能書"}
                        </span>
                      </div>
                      <footer>
                        <button
                          type="button"
                          onClick={() => addCorePointTask(point)}
                        >
                          ＋ 加入今日計畫
                        </button>
                        {hasBook ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => openCorePointBook(point)}
                          >
                            讀智能書
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="primary unavailable"
                            disabled
                          >
                            智能書待上架
                          </button>
                        )}
                      </footer>
                    </article>
                  );
                })}
            </div>
            <p className="hot-points-note">
              目前 88 筆是核心考點整理，不代表已有 88
              組真題。須核對歷屆題的年度、題號與實際爭點後，才會逐筆開放練習。
            </p>
          </section>)}
          </>
        )}
        {activeTab === "listening" && (
          <section className="learning-single-column" aria-label="聽解題專區">
            <div className="column-card listening-feature">
              <div className="column-kicker">LISTENING SOLUTION</div>
              <div className="column-heading">
                <div>
                  <h2>聽解題</h2>
                  <span>已發布的題目都會保留在學習區，方便依序練習</span>
                </div>
                <i>
                  {(
                    homeFeed?.listeningItems ??
                    (homeFeed?.listening ? [homeFeed.listening] : [])
                  ).length
                    ? "▶"
                    : "聽"}
                </i>
              </div>
              {(
                homeFeed?.listeningItems ??
                (homeFeed?.listening ? [homeFeed.listening] : [])
              ).length ? (
                <div className="listening-feed-list">
                  {(
                    homeFeed?.listeningItems ??
                    (homeFeed?.listening ? [homeFeed.listening] : [])
                  ).map((item) => (
                    <article className="listening-feed-item" key={item.id}>
                      <div className="listening-feed-heading">
                        <div>
                          <span>
                            {item.year || "自訂題目"} · {item.subject}
                          </span>
                          <h3>{item.title}</h3>
                        </div>
                        <b>已發布</b>
                      </div>
                      <p>先聽老師如何抓爭點，再留下自己的答題接續點。</p>
                      <ListeningPlayer item={item} />
                    </article>
                  ))}
                </div>
              ) : (
                <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>
              )}
            </div>
          </section>
        )}
        {activeTab === "my-courses" && (
          <section className="my-course-hub" aria-label="我的課">
            <header className="my-course-head">
              <div>
                <p>MY COURSES</p>
                <h2>我的課</h2>
                <span>貼上你正在準備的 YouTube 影片或播放清單；只在你的帳號內保存，不會自動公開。</span>
              </div>
              <strong>{myCourses.length} 堂</strong>
            </header>
            <form className="my-course-add-form" onSubmit={addMyCourse}>
              <label className="my-course-url-field"><span>YouTube 網址</span><input value={myCourseUrl} onChange={(event) => setMyCourseUrl(event.target.value)} placeholder="貼上影片或播放清單網址" required type="url" /></label>
              <label><span>課程名稱（可不填）</span><input value={myCourseTitle} onChange={(event) => setMyCourseTitle(event.target.value)} placeholder="例如：刑法總則線上課" /></label>
              <label><span>科目</span><select value={myCourseSubject} onChange={(event) => { setMyCourseSubject(event.target.value); setMyCourseScope("全科"); }}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
              <label><span>準備階段</span><select value={myCourseExamType} onChange={(event) => setMyCourseExamType(event.target.value)}><option>一試／二試</option><option>一試</option><option>二試</option></select></label>
              <label><span>學習範圍</span><select value={myCourseScope} onChange={(event) => setMyCourseScope(event.target.value)}>{(subjectScopes[myCourseSubject] ?? ["全科"]).map((scope) => <option key={scope}>{scope}</option>)}</select></label>
              <button type="submit" disabled={myCourseLoading}>{myCourseLoading ? "讀取中…" : "加入我的課"}</button>
            </form>
            {myCourseMessage && <p className={`my-course-notice ${myCourseMessage.includes("已加入") ? "success" : "error"}`}>{myCourseMessage}</p>}
            {myCourseJudgement && <div className="my-course-judgement"><span>司律相關性初判</span><strong>{myCourseJudgement.label}</strong><b>{myCourseJudgement.score}%</b><p>{myCourseJudgement.reason}</p></div>}
            <div className="my-course-info"><b>先說明分析範圍</b><span>沒有 SRT 時，平台不會假裝讀過老師完整口述內容；同學可以自行上傳課程截圖、輸入問題，AI 依截圖與問題回答，並可保存成筆記。</span></div>
            <div className={`my-course-workspace ${myCourseListCollapsed ? "my-course-list-collapsed" : ""}`}>
              <aside className={`my-course-list ${myCourseListCollapsed ? "is-collapsed" : ""}`} aria-label="我的課清單">
                <div className="my-course-list-head"><button type="button" className="course-panel-toggle" aria-expanded={!myCourseListCollapsed} onClick={() => setMyCourseListCollapsed((value) => !value)}><span><strong>我的課清單</strong><small>只有你看得到</small></span><b aria-hidden="true">{myCourseListCollapsed ? "›" : "‹"}</b></button></div>
                {!myCourseListCollapsed && <>
                  {myCourses.map((course, index) => <button type="button" className={`my-course-list-item ${selectedMyCourse?.id === course.id ? "active" : ""}`} key={course.id} onClick={() => { resetMyCourseAiDraft(); setSelectedMyCourseId(course.id); setSelectedMyEpisodeId(null); }}><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{course.title}</strong><small>{course.subject} · {course.examType} · {course.scope}</small></span><b>{course.sourceKind === "playlist" ? `${course.metadata?.itemCount || myCoursePlaylistItems[course.id]?.length || "…"} 集` : "影片"}</b></button>)}
                  {!myCourses.length && <p className="my-course-empty">先在上方貼一個 YouTube 網址，這裡就會建立你的第一堂課。</p>}
                </>}
              </aside>
              {selectedMyCourse ? <div className={`my-course-player-layout ${selectedMyCourse.sourceKind === "playlist" ? "has-playlist" : ""} ${myCoursePlaylistCollapsed ? "my-course-playlist-collapsed" : ""}`}>
                {selectedMyCourse.sourceKind === "playlist" && <aside className={`my-course-playlist ${myCoursePlaylistCollapsed ? "is-collapsed" : ""}`} aria-label="我的課播放清單"><div className="my-course-playlist-head"><button type="button" className="course-panel-toggle" aria-expanded={!myCoursePlaylistCollapsed} onClick={() => setMyCoursePlaylistCollapsed((value) => !value)}><span><strong>播放清單</strong><small>{selectedMyPlaylistItems.length ? `${selectedMyPlaylistItems.length} 集` : myCoursePlaylistMessages[selectedMyCourse.id] ?? "正在讀取…"}</small></span><b aria-hidden="true">{myCoursePlaylistCollapsed ? "›" : "‹"}</b></button></div>{!myCoursePlaylistCollapsed && selectedMyPlaylistItems.map((item, index) => <button type="button" className={`my-course-episode ${selectedMyEpisode?.videoId === item.videoId ? "active" : ""}`} key={item.videoId} onClick={() => { resetMyCourseAiDraft(); setSelectedMyEpisodeId(item.videoId); }}><i>{String(index + 1).padStart(2, "0")}</i>{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <span className="my-course-thumb-fallback">▶</span>}<span><strong>{item.title}</strong><small>{item.durationLabel || "YouTube 公開課程"}</small></span></button>)}</aside>}
                <div className="my-course-player"><div className="my-course-player-head"><div><span>正在學習</span><strong>{selectedMyEpisode?.title ?? selectedMyCourse.title}</strong><small>{selectedMyCourse.subject} · {selectedMyCourse.examType} · {selectedMyCourse.relevanceLabel}</small></div><div><a href={selectedMyEpisode ? `https://www.youtube.com/watch?v=${selectedMyEpisode.videoId}` : selectedMyCourse.sourceUrl} target="_blank" rel="noreferrer">在 YouTube 開啟 ↗</a><button type="button" onClick={() => void removeMyCourse(selectedMyCourse)}>移除</button></div></div>{youtubeEmbedUrl(selectedMyEpisode ? `https://www.youtube.com/watch?v=${selectedMyEpisode.videoId}&list=${selectedMyCourse.playlistId ?? ""}` : selectedMyCourse.sourceUrl) ? <iframe className="my-course-youtube-frame" src={youtubeEmbedUrl(selectedMyEpisode ? `https://www.youtube.com/watch?v=${selectedMyEpisode.videoId}&list=${selectedMyCourse.playlistId ?? ""}` : selectedMyCourse.sourceUrl)} title={selectedMyEpisode?.title ?? selectedMyCourse.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <div className="my-course-player-empty">這個網址目前無法嵌入，請在 YouTube 開啟確認。</div>}<div className="my-course-ai" onPaste={(event) => handleScreenshotPaste(event, loadMyCourseScreenshot)}><div className="my-course-ai-head"><b>課程 AI 問答</b><span>沒有 SRT 也能問；可上傳或直接 Ctrl＋V 貼上 YouTube 截圖。</span></div><div className="my-course-ai-upload"><label className="my-course-screenshot-button">{myCourseScreenshotDataUrl ? "更換截圖" : "上傳／貼上截圖"}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadMyCourseScreenshot(file); event.currentTarget.value = ""; }} /></label>{myCourseScreenshotName && <span>{myCourseScreenshotName}</span>}</div>{myCourseScreenshotDataUrl && <div className="my-course-screenshot-preview"><button type="button" className="screenshot-zoom-button" onClick={() => setLightboxImage({ url: myCourseScreenshotDataUrl, alt: "準備提問的課程截圖" })} aria-label="放大課程截圖"><img src={myCourseScreenshotDataUrl} alt="準備提問的課程截圖" /></button><button type="button" onClick={() => { setMyCourseScreenshotDataUrl(""); setMyCourseScreenshotName(""); }} aria-label="移除課程截圖">×</button></div>}<div className="course-ai-thread" aria-live="polite">{myCourseChatMessages.length ? myCourseChatMessages.map((message, index) => <div className={`course-chat-message ${message.role}`} key={`${message.role}-${index}`}><strong>{message.role === "mentor" ? "AI 導師" : "我"}</strong><p>{message.text}</p></div>) : <p className="course-ai-empty">先輸入你的問題；下一次追問時，AI 會接續這一段對話。</p>}{myCourseAiLoading && <div className="course-chat-message mentor"><strong>AI 導師</strong><p>正在依目前截圖與前面對話整理…</p></div>}</div><form className="my-course-ai-form" onSubmit={askMyCourseAi}><textarea rows={3} value={myCourseAiInput} onChange={(event) => setMyCourseAiInput(event.target.value)} placeholder="接著問這張截圖或上一段回答…" disabled={myCourseAiLoading} /><button type="submit" disabled={myCourseAiLoading || !myCourseAiInput.trim()}>{myCourseAiLoading ? "回答中…" : "問 AI"}</button></form>{myCourseAiNotice && <p className="my-course-ai-notice">{myCourseAiNotice}</p>}{myCourseScreenshotDataUrl && <div className="my-course-note-actions"><button type="button" onClick={() => void saveMyCourseScreenshotNote()}>截圖與問答存入本集筆記</button>{myCourseNoteMessage && <span>{myCourseNoteMessage}</span>}</div>}{myCourseNotes.length > 0 && <section className="course-inline-notes" aria-label="這一集的課堂筆記"><div className="course-inline-notes-head"><strong>這一集的筆記</strong><span>{myCourseNotes.length} 則</span></div>{myCourseNotes.slice(0, 5).map((note) => <article key={note.id}><button type="button" className="inline-note-image" onClick={() => { const attachment = note.attachments?.[0]; if (attachment) setLightboxImage({ url: attachment.url, alt: "我的課堂截圖" }); }} aria-label="放大筆記截圖">{note.attachments?.[0]?.url ? <img src={note.attachments[0].url} alt="我的課堂截圖" /> : <span className="inline-note-image-empty">無截圖</span>}</button><div><div className="inline-note-title-row"><strong>{note.title}</strong><button type="button" className="inline-note-edit" onClick={() => setNoteDraft(note)}>編輯內容</button></div><p>{note.content}</p></div></article>)}</section>}</div></div>
              </div> : null}
            </div>
          </section>
        )}
        {activeTab === "public-courses" && (
          <section className="public-course-hub" aria-label="開放課專區">
            <header className="public-course-head">
              <div>
                <p>OPEN COURSES</p>
                <h2>開放課</h2>
                <span>把各科公開課程集中整理成清單；先有刑法，之後可持續加入民法與其他科目。選一堂開始，再回到教材與真題練習。</span>
              </div>
              <strong>{courseCollections.reduce((total, collection) => total + collection.courses.length, 0)} 個播放清單</strong>
            </header>
            <nav className="public-course-subjects" aria-label="公開課程科目篩選">
              {publicCourseSubjects.map((subject) => (
                <button type="button" className={publicCourseSubject === subject ? "active" : ""} key={subject} onClick={() => setPublicCourseSubject(subject)}>{subject}</button>
              ))}
            </nav>
            <div className="public-course-collection-grid">
              {courseCollections.map((collection) => {
                const visibleCourses = collection.courses.filter((course) => publicCourseSubject === "全部" || course.subject === publicCourseSubject);
                if (!visibleCourses.length) return null;
                const selectedCourse = visibleCourses.find((course) => course.id === selectedPublicCourseId) ?? visibleCourses[0] ?? null;
                const selectedPlaylistItems = selectedCourse ? playlistItemsByCourse[selectedCourse.id] ?? [] : [];
                const selectedEpisode = selectedPlaylistItems.find((item) => item.videoId === selectedPublicEpisodeId) ?? selectedPlaylistItems[0] ?? null;
                return (
                  <article className="public-course-collection" key={collection.id}>
                    <header><div><span>COURSE COLLECTION</span><h3>{collection.title}</h3><p>{collection.description || "後台貼一次播放清單網址，學生可在這裡選擇每一集。"}</p></div><b>{visibleCourses.length} 個播放清單</b></header>
                    <div className="public-course-list" aria-label={`${collection.title}課程清單`}>
                      <div className="public-course-list-heading"><strong>課程清單</strong><span>選擇課程後，下方會開啟播放區</span></div>
                      {visibleCourses.map((course, index) => (
                        <button type="button" className={`public-course-list-item ${selectedPublicCourseId === course.id ? "active" : ""}`} key={course.id} onClick={() => { resetPublicCourseAiDraft(); setSelectedPublicCourseId(course.id); setSelectedPublicEpisodeId(null); }}>
                          <i>{String(index + 1).padStart(2, "0")}</i>
                          <span><strong>{course.title}</strong><small>{course.subject} · {course.creator || "公開課程"}</small>{course.description && <em>{course.description}</em>}</span>
                          <b>{selectedPublicCourseId === course.id ? "目前課程" : isYoutubePlaylist(course.sourceUrl) ? `${playlistItemsByCourse[course.id]?.length ?? "…"} 集` : "開始播放"}</b>
                        </button>
                      ))}
                    </div>
                    {selectedCourse && (
                      <div className={`public-course-study-grid ${isYoutubePlaylist(selectedCourse.sourceUrl) ? "has-playlist" : "no-playlist"} ${publicPlaylistCollapsed ? "public-playlist-collapsed" : ""}`}>
                        {isYoutubePlaylist(selectedCourse.sourceUrl) && (
                          <aside className={`public-playlist-panel ${publicPlaylistCollapsed ? "is-collapsed" : ""}`} aria-label={`${selectedCourse.title}播放清單`}>
                            <div className="public-playlist-heading">
                              <button type="button" className="public-playlist-toggle" aria-expanded={!publicPlaylistCollapsed} onClick={() => setPublicPlaylistCollapsed((value) => !value)}><span><strong>播放清單</strong><small>{selectedPlaylistItems.length ? `${selectedPlaylistItems.length} 集，可直接選擇` : "正在載入每一集…"}</small></span><b aria-hidden="true">{publicPlaylistCollapsed ? "›" : "‹"}</b></button>
                            </div>
                            {!publicPlaylistCollapsed && selectedPlaylistItems.length ? (
                              <div className="public-playlist-items">
                                {selectedPlaylistItems.map((item, index) => (
                                  <button type="button" className={`public-playlist-item ${selectedEpisode?.videoId === item.videoId ? "active" : ""}`} key={item.videoId} onClick={() => { resetPublicCourseAiDraft(); setSelectedPublicCourseId(selectedCourse.id); setSelectedPublicEpisodeId(item.videoId); }}>
                                    <i>{String(index + 1).padStart(2, "0")}</i>
                                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <span className="public-playlist-thumb-fallback">▶</span>}
                                    <span><strong>{item.title}</strong><small>{item.durationLabel || "YouTube 公開課程"}</small></span>
                                    <b>{selectedEpisode?.videoId === item.videoId ? "播放中" : "播放"}</b>
                                  </button>
                                ))}
                              </div>
                            ) : !publicPlaylistCollapsed ? <p className="public-playlist-status">{playlistMessages[selectedCourse.id] ?? "正在從 YouTube 讀取播放清單，請稍候。"}</p> : null}
                          </aside>
                        )}
                        <div className="public-course-player">
                          <div className="public-course-player-head"><div><span>正在學習</span><strong>{selectedEpisode?.title ?? selectedCourse.title}</strong><small>{selectedCourse.creator || "公開課程"} · {selectedCourse.subject}</small></div><a href={selectedEpisode ? `https://www.youtube.com/watch?v=${selectedEpisode.videoId}` : selectedCourse.sourceUrl} target="_blank" rel="noreferrer">在 YouTube 開啟 ↗</a></div>
                          {youtubeEmbedUrl(selectedEpisode ? `https://www.youtube.com/watch?v=${selectedEpisode.videoId}&list=${new URL(selectedCourse.sourceUrl).searchParams.get("list") ?? ""}` : selectedCourse.sourceUrl) ? <iframe className="public-course-youtube-frame" src={youtubeEmbedUrl(selectedEpisode ? `https://www.youtube.com/watch?v=${selectedEpisode.videoId}&list=${new URL(selectedCourse.sourceUrl).searchParams.get("list") ?? ""}` : selectedCourse.sourceUrl)} title={`${selectedEpisode?.title ?? selectedCourse.title}公開課程`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <div className="public-course-player-empty">這堂課尚未設定可播放網址，請回到後台補上。</div>}
                          <div className="public-course-ai" onPaste={(event) => handleScreenshotPaste(event, (file) => loadCourseScreenshotFile(file, setPublicCourseScreenshotDataUrl, setPublicCourseScreenshotName, setPublicCourseAiNotice))}>
                            <div className="public-course-ai-head"><strong>這一集可以問 AI</strong><span>可上傳或直接 Ctrl＋V 貼上 YouTube 截圖；平台會接續前面的問答。</span></div>
                            <div className="public-course-ai-upload"><label className="my-course-screenshot-button">{publicCourseScreenshotDataUrl ? "更換截圖" : "上傳／貼上截圖"}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadCourseScreenshotFile(file, setPublicCourseScreenshotDataUrl, setPublicCourseScreenshotName, setPublicCourseAiNotice); event.currentTarget.value = ""; }} /></label>{publicCourseScreenshotName && <span>{publicCourseScreenshotName}</span>}</div>
                            {publicCourseScreenshotDataUrl && <div className="my-course-screenshot-preview"><button type="button" className="screenshot-zoom-button" onClick={() => setLightboxImage({ url: publicCourseScreenshotDataUrl, alt: "準備提問的公開課截圖" })} aria-label="放大公開課截圖"><img src={publicCourseScreenshotDataUrl} alt="準備提問的公開課截圖" /></button><button type="button" onClick={() => { setPublicCourseScreenshotDataUrl(""); setPublicCourseScreenshotName(""); }} aria-label="移除公開課截圖">×</button></div>}
                            <div className="course-ai-thread" aria-live="polite">{publicCourseChatMessages.length ? publicCourseChatMessages.map((message, index) => <div className={`course-chat-message ${message.role}`} key={`${message.role}-${index}`}><strong>{message.role === "mentor" ? "AI 導師" : "我"}</strong><p>{message.text}</p></div>) : <p className="course-ai-empty">先輸入你的問題；下一次追問時，AI 會接續這一段對話。</p>}{publicCourseAiLoading && <div className="course-chat-message mentor"><strong>AI 導師</strong><p>正在依目前截圖與前面對話整理…</p></div>}</div>
                            <form className="my-course-ai-form" onSubmit={askPublicCourseAi}><textarea rows={3} value={publicCourseAiInput} onChange={(event) => setPublicCourseAiInput(event.target.value)} placeholder="接著問這張截圖或上一段回答…" disabled={publicCourseAiLoading} /><button type="submit" disabled={publicCourseAiLoading || !publicCourseAiInput.trim()}>{publicCourseAiLoading ? "回答中…" : "問 AI"}</button></form>
                            {publicCourseAiNotice && <p className="my-course-ai-notice">{publicCourseAiNotice}</p>}
                            {publicCourseScreenshotDataUrl && <div className="my-course-note-actions"><button type="button" onClick={() => void savePublicCourseScreenshotNote()}>截圖與問答存入本集筆記</button>{publicCourseNoteMessage && <span>{publicCourseNoteMessage}</span>}</div>}
                            {publicCourseNotes.length > 0 && <section className="course-inline-notes" aria-label="這一集的課堂筆記"><div className="course-inline-notes-head"><strong>這一集的筆記</strong><span>{publicCourseNotes.length} 則</span></div>{publicCourseNotes.slice(0, 5).map((note) => <article key={note.id}><button type="button" className="inline-note-image" onClick={() => { const attachment = note.attachments?.[0]; if (attachment) setLightboxImage({ url: attachment.url, alt: "開放課堂截圖" }); }} aria-label="放大筆記截圖">{note.attachments?.[0]?.url ? <img src={note.attachments[0].url} alt="開放課堂截圖" /> : <span className="inline-note-image-empty">無截圖</span>}</button><div><div className="inline-note-title-row"><strong>{note.title}</strong><button type="button" className="inline-note-edit" onClick={() => setNoteDraft(note)}>編輯內容</button></div><p>{note.content}</p></div></article>)}</section>}
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {!courseCollections.length && <div className="public-course-empty">目前尚未發布公開課；管理員發布後會在這裡顯示。</div>}
            {courseCollections.length > 0 && !courseCollections.some((collection) => collection.courses.some((course) => publicCourseSubject === "全部" || course.subject === publicCourseSubject)) && <div className="public-course-empty">這個科目目前尚未加入公開課，之後可由管理後台新增。</div>}
          </section>
        )}
        {(activeTab === "books" || activeTab === "courses") && (
          <section
            className="resource-learning-hub"
            aria-label={activeTab === "books" ? "智能書" : "來一課"}
          >
            <div className="resource-learning-head">
              <div>
                <p>{activeTab === "books" ? "READING ROOM" : "COURSE ROOM"}</p>
                <h2>{activeTab === "books" ? "智能書" : "來一課"}</h2>
                <span>
                  {activeTab === "books"
                    ? "不開啟 PDF；選章節後由 AI 依教材內容教學。"
                    : "留在學習專區內完成；進度、今日計畫與學習紀錄會連在一起。"}
                </span>
              </div>
              <span className="resource-count">
                {
                  (activeTab === "books" ? bookResources : courseResources)
                    .length
                }{" "}
                項
              </span>
            </div>
            {activeTab === "books" && (
              <section
                className="book-topic-search"
                aria-label="搜尋智能書主題"
              >
                <div className="book-topic-search-copy">
                  <strong>搜尋書中主題</strong>
                  <span>
                    {selectedResource?.resourceType === "book"
                      ? `搜尋《${selectedResource.title}》的章節與教材全文`
                      : "先選一本智能書，再輸入想找的法律主題"}
                  </span>
                </div>
                <form onSubmit={searchBookFullText}>
                  <label>
                    <span aria-hidden>⌕</span>
                    <input
                      value={bookSearchQuery}
                      onChange={(event) => {
                        setBookSearchQuery(event.target.value);
                        setBookFullTextHits([]);
                        setBookFullTextMessage("");
                      }}
                      placeholder="例如：未遂犯與不能未遂、正當防衛、客觀歸責"
                      disabled={
                        selectedResource?.resourceType !== "book" ||
                        bookChaptersLoading ||
                        bookFullTextLoading
                      }
                    />
                    {bookSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setBookSearchQuery("");
                          setBookFullTextHits([]);
                          setBookFullTextMessage("");
                        }}
                        aria-label="清除搜尋"
                      >
                        ×
                      </button>
                    )}
                  </label>
                  <button
                    type="submit"
                    disabled={
                      bookSearchQuery.trim().length < 2 ||
                      bookFullTextLoading ||
                      selectedResource?.resourceType !== "book"
                    }
                  >
                    {bookFullTextLoading ? "正在查教材全文…" : "搜尋教材全文"}
                  </button>
                </form>
                {bookSearchQuery.trim() && (
                  <div className="book-topic-results" aria-live="polite">
                    <div className="book-topic-result-heading">
                      <strong>
                        {bookSearchResults.length
                          ? `章名／摘要命中 ${bookSearchResults.length} 處`
                          : "章名與摘要未直接命中"}
                      </strong>
                      <span>下方全文搜尋會再查書內實際段落，不只比對目錄</span>
                    </div>
                    {bookSearchResults.map(({ chapter, index, matched }) => (
                      <button
                        type="button"
                        key={chapter.id}
                        onClick={() =>
                          void startBookChapter(
                            chapter,
                            false,
                            bookSearchQuery.trim(),
                          )
                        }
                      >
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        <div>
                          <strong>{highlightBookText(chapter.title)}</strong>
                          {chapter.summary && (
                            <small>{highlightBookText(chapter.summary)}</small>
                          )}
                          <em>
                            章節命中：{matched.slice(0, 3).join("、")}
                            {chapter.pageStart
                              ? ` · 第 ${chapter.pageStart}${chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""} 頁`
                              : ""}
                          </em>
                        </div>
                        <span>讀這一章 →</span>
                      </button>
                    ))}
                    {bookFullTextMessage && (
                      <p className="book-fulltext-message">
                        {bookFullTextMessage}
                      </p>
                    )}
                    {bookFullTextHits.map((hit, index) => {
                      const chapter = chapterForFullTextHit(hit);
                      return (
                        <button
                          type="button"
                          className="book-fulltext-hit"
                          key={`${hit.section}-${index}`}
                          disabled={!chapter}
                          onClick={() =>
                            chapter &&
                            void startBookChapter(
                              chapter,
                              false,
                              `${bookSearchQuery.trim()}；教材命中：${hit.section}—${hit.excerpt}`,
                            )
                          }
                        >
                          <b>文</b>
                          <div>
                            <strong>{highlightBookText(hit.section)}</strong>
                            <small>{highlightBookText(hit.excerpt)}</small>
                            <em>
                              教材全文命中
                              {hit.page_start
                                ? ` · 第 ${hit.page_start}${hit.page_end && hit.page_end !== hit.page_start ? `–${hit.page_end}` : ""} 頁`
                                : ""}
                              {hit.relevance ? ` · ${hit.relevance}` : ""}
                            </em>
                          </div>
                          <span>
                            {chapter
                              ? "開啟所屬章節 →"
                              : "已找到內文；章節待核對"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
            <div className="resource-learning-layout">
              <aside
                className={`resource-list ${activeTab === "books" ? "book-resource-list" : ""}`}
                aria-label="可學習資源"
              >
                <div className="resource-list-heading">
                  <strong>
                    {activeTab === "books" ? "書本清單" : "來一課清單"}
                  </strong>
                  <span>
                    共{" "}
                    {
                      (activeTab === "books" ? bookResources : courseResources)
                        .length
                    }{" "}
                    項
                  </span>
                </div>
                {activeTab === "books"
                  ? bookResources.map((resource) => {
                      const isSelected = selectedResource?.id === resource.id;
                      const isExpanded = currentExpandedBookId === resource.id;
                      return (
                        <div
                          className={`book-resource-card ${isSelected ? "active" : ""}`}
                          key={resource.id}
                        >
                          <button
                            className="book-resource-trigger"
                            aria-expanded={isExpanded}
                            onClick={() => {
                              setSelectedResourceId(resource.id);
                              setExpandedBookId(
                                isExpanded ? null : resource.id,
                              );
                              setSelectedSegmentId(null);
                              setSelectedChapterId(null);
                              setBookMessages([]);
                              setResourceMessage("");
                            }}
                          >
                            <span>書</span>
                            <div>
                              <strong>{resource.title}</strong>
                              <small>
                                {resource.subject}
                                {resource.creator
                                  ? ` · ${resource.creator}`
                                  : ""}
                              </small>
                              <em>
                                {resourceProgress[String(resource.id)]
                                  ? "已有學習紀錄"
                                  : resource.documentId
                                    ? "教材已綁定，點此展開章節"
                                    : "尚未綁定教材"}
                              </em>
                            </div>
                            <b aria-hidden>{isExpanded ? "−" : "+"}</b>
                          </button>
                          {isExpanded && (
                            <div
                              className={`book-resource-chapters ${isProblemSolvingBook(resource) ? "problem-outline" : ""}`}
                              aria-label={`${resource.title}目錄`}
                            >
                              <div className="book-chapter-heading">
                                <strong>
                                  {isProblemSolvingBook(resource)
                                    ? "解題目錄"
                                    : "本書章節"}
                                </strong>
                                <span>
                                  {bookChaptersLoading && isSelected
                                    ? "正在準備…"
                                    : bookChapters.length && isSelected
                                      ? `${bookChapters.length} ${isProblemSolvingBook(resource) ? "題型" : "章"}`
                                      : "尚未建立"}
                                </span>
                              </div>
                              {!isSelected ? (
                                <div className="book-chapter-empty">
                                  選取這本書後載入目錄。
                                </div>
                              ) : bookChaptersLoading ? (
                                <div className="book-chapter-empty">
                                  正在依原書目錄整理，完成後會自動顯示…
                                </div>
                              ) : bookChapters.length ? (
                                isProblemSolvingBook(resource) ? (
                                  selectedBookOutline.map((part) => (
                                    <details
                                      className="problem-part"
                                      key={part.section}
                                      open
                                    >
                                      <summary>
                                        <h4>{part.section}</h4>
                                        <em>{part.topics.reduce((total, topic) => total + topic.questions.length, 0)} 題型</em>
                                      </summary>
                                      {part.topics.map((topic) => (
                                        <details
                                          className="problem-topic"
                                          key={`${part.section}-${topic.topic}`}
                                          open={topic.questions.some((question) => question.id === selectedChapterId)}
                                        >
                                          <summary>
                                            <h5>{topic.topic}</h5>
                                            <em>{topic.questions.length} 題型</em>
                                          </summary>
                                          {topic.questions.map((chapter) => (
                                            <button
                                              type="button"
                                              key={chapter.id}
                                              disabled={chapter.completeQuestion === false}
                                              className={
                                                `${selectedChapter?.id ===
                                                chapter.id
                                                  ? "active"
                                                  : ""}${chapter.completeQuestion === false ? " catalogue-only" : ""}`
                                              }
                                              onClick={() =>
                                                void startBookChapter(chapter)
                                              }
                                            >
                                              <strong title={chapter.title}>{chapter.title}</strong>
                                              {chapter.completeQuestion === false && (
                                                <small>題文整理中</small>
                                              )}
                                              {chapter.pageStart && (
                                                <em>
                                                  第 {chapter.pageStart}
                                                  {chapter.pageEnd &&
                                                  chapter.pageEnd !==
                                                    chapter.pageStart
                                                    ? `–${chapter.pageEnd}`
                                                    : ""}{" "}
                                                  頁
                                                </em>
                                              )}
                                            </button>
                                          ))}
                                        </details>
                                      ))}
                                    </details>
                                  ))
                                ) : (
                                  bookChapters.map((chapter, index) => (
                                    <button
                                      key={chapter.id}
                                      className={
                                        selectedChapter?.id === chapter.id
                                          ? "active"
                                          : ""
                                      }
                                      onClick={() =>
                                        void startBookChapter(chapter)
                                      }
                                  >
                                    <span>
                                        {String(index + 1).padStart(2, "0")}
                                      </span>
                                      <div>
                                        <strong>{chapter.title}</strong>
                                        {chapter.summary && (
                                          <small>{chapter.summary}</small>
                                        )}
                                        {chapter.pageStart && (
                                          <em>
                                            第 {chapter.pageStart}
                                            {chapter.pageEnd &&
                                            chapter.pageEnd !==
                                              chapter.pageStart
                                              ? `–${chapter.pageEnd}`
                                              : ""}{" "}
                                            頁
                                          </em>
                                        )}
                                      </div>
                                    </button>
                                  ))
                                )
                              ) : (
                                <div className="book-chapter-empty">
                                  {bookChapterMessage ||
                                    "教材索引完成後，目錄會在這裡建立。"}
                                  <br />
                                  <button
                                    type="button"
                                    className="chapter-retry"
                                    onClick={() => {
                                      chapterBuildAttemptedRef.current.delete(
                                        resource.id,
                                      );
                                      void loadBookChapters(resource.id);
                                    }}
                                  >
                                    重新建立目錄
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  : courseResources.map((resource, index) => (
                      <button
                        key={resource.id}
                        className={
                          selectedResource?.id === resource.id ? "active" : ""
                        }
                        onClick={() => {
                          setSelectedResourceId(resource.id);
                          setSelectedSegmentId(null);
                          setSelectedChapterId(null);
                          setBookMessages([]);
                          setResourceMessage("");
                        }}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{resource.title}</strong>
                          <small>
                            {resource.subject}
                            {resource.creator ? ` · ${resource.creator}` : ""}
                          </small>
                          <em>
                            {resourceProgress[String(resource.id)]
                              ? "已有學習紀錄"
                              : "尚未開始"}
                          </em>
                        </div>
                      </button>
                    ))}
                {!(activeTab === "books" ? bookResources : courseResources)
                  .length && (
                  <div className="resource-empty">
                    {activeTab === "books"
                      ? "後台尚未建立書籍資源。"
                      : courseCollectionsLoaded
                        ? "目前尚未建立來一課課程。開放課請到「開放課」查看。"
                        : "正在載入來一課分類…"}
                  </div>
                )}
              </aside>
              {selectedResource ? (
                <article
                  className={`resource-study-panel ${selectedResource.resourceType === "book" ? "book-study-panel" : ""} ${bookFocusMode ? "book-focus-mode" : ""}`}
                >
                  <header>
                    <div>
                      <span>
                        {selectedResource.subject} ·{" "}
                        {selectedResource.resourceType === "book"
                          ? "書籍"
                          : "影音課程"}
                      </span>
                      <h3>{selectedResource.title}</h3>
                      {selectedResource.creator && (
                        <small>{selectedResource.creator}</small>
                      )}
                    </div>
                    <div className="resource-panel-actions">
                      <button
                        className="secondary-btn"
                        onClick={() => void addResourceTask(selectedResource)}
                      >
                        ＋ 加入今日計畫
                      </button>
                      <button
                        className="primary-btn"
                        onClick={() =>
                          void logResourceStudy(
                            selectedResource,
                            selectedResource.resourceType === "course"
                              ? 45
                              : 60,
                            selectedResource.resourceType === "course"
                              ? "下次從上次字幕段落接續"
                              : `下次從${selectedChapter?.title ? `「${selectedChapter.title}」` : "目前章節"}接續`,
                          )
                        }
                      >
                        完成本次學習
                      </button>
                    </div>
                  </header>
                  {resourceMessage && (
                    <p className="resource-message">{resourceMessage}</p>
                  )}
                  {selectedResource.resourceType === "book" ? (
                    <div className="book-learning-room">
                      <section
                        className={`book-ai-dialogue ${selectedBookIsProblemSolving ? "problem-solving-room" : ""}`}
                        aria-label={
                          selectedBookIsProblemSolving
                            ? "解題書題目"
                            : "書籍 AI 教學"
                        }
                      >
                        <div className="book-ai-heading">
                          <div>
                            <span>
                              {selectedBookIsProblemSolving
                                ? "刑法解題書"
                                : "AI 教材教學"}
                            </span>
                            <strong>
                              {selectedChapter
                                ? selectedChapter.title
                                : selectedBookIsProblemSolving
                                  ? "先從左側選一個題型"
                                  : "先選一個章節"}
                            </strong>
                          </div>
                          <div className="book-heading-actions">
                            {!bookFocusMode && <small>
                              {selectedBookIsProblemSolving
                                ? selectedChapter
                                  ? "先看完整題目，再開始審題"
                                  : "依原書的部分、主題與題型選題"
                                : selectedChapter
                                  ? "依本章內容開始對話"
                                  : "從左側書本下方展開章節，AI 會直接開始教你"}
                            </small>}
                            <button type="button" className="book-focus-toggle" onClick={() => { setBookFocusMode((active) => !active); setBookSettingsOpen(false); }} aria-pressed={bookFocusMode}>
                              {bookFocusMode ? "退出專注模式" : "放大對話"}
                            </button>
                          </div>
                        </div>
                        {(
                          <section className={`book-history-panel ${bookHistoryOpen ? "is-open" : ""}`} aria-label="智能書學習紀錄">
                            <div className="book-history-heading">
                              <div>
                                <strong>智能書學習紀錄</strong>
                                <span>{bookHistoryLoading ? "正在讀取…" : bookHistory.length ? `已保存 ${bookHistory.length} 次學習` : bookSessionId ? "本次學習已保存" : "開始後會自動保存"}</span>
                              </div>
                              {bookHistory.length > 0 && <button type="button" onClick={() => setBookHistoryOpen((open) => !open)} aria-expanded={bookHistoryOpen}>
                                {bookHistoryOpen ? "收起紀錄" : "查看紀錄"}
                              </button>}
                            </div>
                            {bookHistoryOpen && bookHistory.length > 0 && (
                              <div className="book-history-list">
                                {bookHistory.map((entry) => {
                                  const historyChapter = bookChapters.find((item) => item.id === entry.segmentId);
                                  const date = new Date(entry.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
                                  return (
                                    <button type="button" key={entry.id} className={`book-history-item ${bookSessionId === entry.id ? "active" : ""}`} onClick={() => void openBookHistory(entry)} disabled={!historyChapter || bookChatLoading}>
                                      <span>{historyChapter?.title ?? entry.title.replace(/^書籍｜[^｜]+｜/, "")}</span>
                                      <small>{date} · {entry.messageCount} 則對話</small>
                                      <em>{bookSessionId === entry.id ? "目前紀錄" : "開啟這段對話"}</em>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        )}
                        {selectedChapter ? (
                          <div className="book-dialogue-body">
                            {selectedBookIsProblemSolving && (
                              <div className="problem-question-panel">
                                <div className="problem-question-meta">
                                  <div>
                                    <span>
                                      {selectedChapter.lessonLabel.replace(
                                        "｜",
                                        " · ",
                                      )}
                                    </span>
                                    {selectedChapter.pageStart && (
                                      <em>
                                        第 {selectedChapter.pageStart}
                                        {selectedChapter.pageEnd &&
                                        selectedChapter.pageEnd !==
                                          selectedChapter.pageStart
                                          ? `–${selectedChapter.pageEnd}`
                                          : ""} 頁
                                      </em>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="problem-question-toggle"
                                    aria-expanded={bookQuestionOpen}
                                    onClick={() => setBookQuestionOpen((open) => !open)}
                                  >
                                    {bookQuestionOpen ? "收起題目" : "展開題目"}
                                  </button>
                                </div>
                                {bookQuestionOpen && <>
                                  <h4>{selectedChapter.title}</h4>
                                  <div className="problem-question-stem">
                                    {studentProblemParagraphs(selectedChapter.text, selectedChapter.title).length
                                      ? studentProblemParagraphs(selectedChapter.text, selectedChapter.title).map((paragraph, index) => (
                                          <p key={`${selectedChapter.id}-question-${index}`}>{paragraph}</p>
                                        ))
                                      : <p>完整題目尚未從原書索引擷取完成；核對前不由 AI 補造內容。</p>}
                                  </div>
                                  <button
                                    type="button"
                                    className="problem-start-button"
                                    disabled={!studentProblemQuestion(selectedChapter.text, selectedChapter.title)}
                                    onClick={() =>
                                      void startBookReview()
                                    }
                                  >
                                    開始引導教學
                                  </button>
                                </>}
                              </div>
                            )}
                            {selectedBookIsProblemSolving && bookMessages.length === 0 && (
                              <section className="book-guided-learning-intro" aria-label="AI 引導教學說明">
                                <strong>AI 會依老師解析逐步帶你解題</strong>
                                <p>先辨認行為人與關鍵事實，再引導你找出爭點、判準與涵攝；每一步都會回應你的想法，最後整理成完整解題架構。</p>
                                <small>不必先寫完整答案。想深入比較學說或覆核結論時，再請 Sol 補充。</small>
                              </section>
                            )}
                            <div ref={bookDialogueMessagesRef} className="book-dialogue-messages">
                              {bookMessages.filter((message) => simulationToolsEnabled || message.role !== "scholar").map((message, index) => (
                                <div
                                  key={`${message.role}-${index}`}
                                  className={`book-dialogue-message ${message.role}`}
                                >
                                  <span>
                                    {message.role === "mentor"
                                      ? "AI 導師"
                                      : message.role === "scholar"
                                        ? "AI 學霸"
                                        : "你"}
                                  </span>
                                    {message.comparison ? (
                                      <div className="book-model-comparison" aria-label="解題書雙模型回答比較">
                                        {message.comparison.responses.map((response) => (
                                          <article key={`${response.id}-${response.label}`}>
                                            <header><strong>{response.label}</strong><small>{response.model}</small></header>
                                            {response.error ? <p className="book-model-error">{response.error}</p> : <p>{response.text}</p>}
                                            <footer>{response.usage.inputTokens + response.usage.outputTokens} tokens · {response.usage.durationMs.toLocaleString()} ms · US$ {response.usage.estimatedCostUsd.toFixed(5)}</footer>
                                          </article>
                                        ))}
                                      </div>
                                    ) : <p>{message.text}</p>}
                                    {message.role === "mentor" && message.text.includes("完整解題架構已完成") && (
                                      <button type="button" className="book-direct-solution-button" onClick={() => void submitBookMessage("開始考場擬答。請立即依本題老師解析，按照老師原本的行為人與罪名順序，直接生成可在考場落筆的完整申論答案；必須包含標題、法條、要件或學說、具體事實涵攝及每位行為人的完整罪責結論。不要再提問，不要只提供寫作提示、架構或順序說明。") } disabled={bookChatLoading}>
                                        開始考場擬答
                                      </button>
                                    )}
                                    {message.usage && !message.comparison && <small className="book-ai-usage">{message.usage.model} · {message.usage.inputTokens + message.usage.outputTokens} tokens · {message.usage.durationMs.toLocaleString()} ms · US$ {message.usage.estimatedCostUsd.toFixed(5)}</small>}
                                    {message.role === "mentor" && message.teachingEvidence && (
                                      <div className={`book-teaching-evidence ${message.teachingEvidence.status}`}>
                                        <strong>
                                          {message.teachingEvidence.status === "verified"
                                            ? message.teachingEvidence.basis === "teacher_solution"
                                              ? "✓ 依本題老師解析／擬答教學"
                                              : "✓ 教材原文直接支持本次教學內容"
                                            : message.teachingEvidence.status === "applied_inference"
                                              ? "◆ 教材提供判準，AI 依原文涵攝"
                                            : message.teachingEvidence.status === "full_text_search"
                                              ? message.teachingEvidence.retrieval === "full_text_search"
                                                ? "△ 命中全文索引，章節待核對"
                                                : ""
                                              : "! 尚未取得本章原文"}
                                        </strong>
                                        <span>
                                          {message.teachingEvidence.status === "verified" || message.teachingEvidence.status === "applied_inference"
                                            ? selectedBookIsProblemSolving
                                              ? message.teachingEvidence.basis === "teacher_solution"
                                                ? `${message.teachingEvidence.resourceTitle}｜${message.teachingEvidence.segmentTitle}｜老師答案為主要依據`
                                                : `${message.teachingEvidence.resourceTitle}｜${message.teachingEvidence.segmentTitle}`
                                              : `${message.teachingEvidence.resourceTitle || "未設定教材名稱"}｜${message.teachingEvidence.segmentTitle}｜${message.teachingEvidence.pageStart ? `第 ${message.teachingEvidence.pageStart}${message.teachingEvidence.pageEnd && message.teachingEvidence.pageEnd !== message.teachingEvidence.pageStart ? `–${message.teachingEvidence.pageEnd}` : ""} 頁` : "頁碼待核對"}`
                                            : message.teachingEvidence.message}
                                        </span>
                                        {message.teachingEvidence.excerpt && !selectedBookIsProblemSolving && (
                                          <details className="book-evidence-excerpt"><summary>查看教材原文與判定依據</summary><p>{message.teachingEvidence.excerpt}</p>{message.teachingEvidence.matchedTerms?.length ? <small>命中關鍵：{message.teachingEvidence.matchedTerms.join("、")}</small> : null}<small>上方章節頁碼依教材檔案頁序標示；原文註腳中的其他頁碼屬引用書目頁碼。</small>{message.teachingEvidence.status === "applied_inference" ? <small>教材提供抽象判準；具體罪名或事實判斷由 AI 依判準完成。</small> : null}</details>
                                        )}
                                      </div>
                                    )}
                                    {message.role === "mentor" && (
                                      <label className={`book-message-reply ${bookSelectedMessageIndex === index ? "is-selected" : ""}`}>
                                        <input
                                          type="checkbox"
                                          checked={bookSelectedMessageIndex === index}
                                          onChange={() => setBookSelectedMessageIndex((current) => current === index ? null : index)}
                                          disabled={bookChatLoading}
                                        />
                                        <span>回覆此訊息</span>
                                      </label>
                                    )}
                                  </div>
                              ))}
                              {bookChatLoading && (
                                <div className="book-dialogue-message mentor">
                                  <span>{bookLoadingRole === "scholar" ? "AI 學霸" : "AI 導師"}</span>
                                  <p className="book-typing">{bookLoadingRole === "scholar" ? "AI 學霸正在回答 AI 導師的問題…" : "AI 導師正在立即回饋你的回答…"}</p>
                                </div>
                              )}
                            </div>
                            <div className="book-dialogue-composer-wrap">
                              {currentMember?.canAdmin && simulationToolsEnabled && <section className={`book-ai-controls model-mode-switch ${bookSettingsOpen ? "" : "is-collapsed"}`} aria-label="AI 學習設定">
                                <div className="model-mode-heading">
                                  <strong>AI 學習設定</strong>
                                  <span className="model-mode-summary">{bookTeachingLevelLabels[bookTeachingLevel ?? "general"]} · {bookModelMode.startsWith("compare-") ? bookModelMode.slice("compare-".length).split("-").map((item) => item === "luna" ? "Luna" : item === "sonnet" ? "Sonnet" : "DeepSeek").join("＋") : bookModelMode === "luna" ? "Luna" : bookModelMode === "sonnet" ? "Claude Sonnet" : "DeepSeek V4-Pro"}</span>
                                  <button type="button" className="model-settings-toggle" aria-expanded={bookSettingsOpen} onClick={() => setBookSettingsOpen((open) => !open)}>{bookSettingsOpen ? "收合設定" : "展開設定"}</button>
                                </div>
                                {bookSettingsOpen && <>
                                  <div className="book-ai-fields">
                                    <label><span>學生</span><select value={bookTeachingLevel ?? "general"} onChange={(event) => { const value = event.target.value as "general" | "beginner" | "intermediate" | "advanced" | "super"; if (value === "general") { setBookTeachingLevel(null); saveBookAiSettings({ teachingLevel: null }); setBookTestNotice(`已切換為${bookTeachingLevelLabels.general}`); } else { prepareBookLevelQuestion(value); } }} disabled={bookSettingsPinned || bookChatLoading}>
                                      <option value="general">{bookTeachingLevelLabels.general}</option><option value="beginner">{bookTeachingLevelLabels.beginner}</option><option value="intermediate">{bookTeachingLevelLabels.intermediate}</option><option value="advanced">{bookTeachingLevelLabels.advanced}</option><option value="super">{bookTeachingLevelLabels.super}</option>
                                    </select></label>
                                    <label><span>回答</span><select value={bookModelMode.startsWith("compare-") ? bookModelMode.split("-")[1] : bookModelMode} onChange={(event) => { const mode = event.target.value as BookModelMode; setBookModelMode(mode); saveBookAiSettings({ modelMode: mode }); }} disabled={bookSettingsPinned || bookChatLoading}>
                                      <option value="luna">Luna</option><option value="sonnet">Claude Sonnet</option><option value="deepseek">DeepSeek V4-Pro</option>
                                    </select></label>
                                    <label><span>比較</span><select value={bookModelMode.startsWith("compare-") ? bookModelMode.slice("compare-".length) : "none"} onChange={(event) => { const value = event.target.value; const mode = value === "none" ? (bookModelMode.startsWith("compare-") ? bookModelMode.split("-")[1] as BookModelMode : bookModelMode) : value as BookModelMode; setBookModelMode(mode); saveBookAiSettings({ modelMode: mode }); }} disabled={bookSettingsPinned || bookChatLoading}>
                                      <option value="none">不比較</option><option value="luna-sonnet">Luna＋Sonnet</option><option value="luna-deepseek">Luna＋DeepSeek</option><option value="sonnet-deepseek">Sonnet＋DeepSeek</option><option value="luna-sonnet-deepseek">Luna＋Sonnet＋DeepSeek</option>
                                    </select></label>
                                  </div>
                                  <div className={`model-settings-pin-row ${bookSettingsPinned ? "is-pinned" : ""}`}>
                                    <label className="model-settings-pin"><input type="checkbox" checked={bookSettingsPinned} onChange={(event) => toggleBookSettingsPinned(event.target.checked)} disabled={bookChatLoading} /><span>固定此角色與模型</span></label>
                                    <small>{bookSettingsPinned ? "已固定；取消勾選後即可重新選擇。" : "固定後所有智能書都沿用目前的學生角色與回答模型。"}</small>
                                  </div>
                                  <small>{bookTestNotice || "按「學霸怎麼想？」可查看示範判斷、思考路徑與延伸反問；本次計入陪練 1 輪。"}</small>
                                </>}
                              </section>}
                              <div className="book-dialogue-composer-actions">
                                <span>{bookSelectedMessageIndex === null ? "可自行回答，或使用反思助手查看答題思路" : "已指定一則 AI 導師訊息"}</span>
                                {selectedBookIsProblemSolving && bookMessages.some((message) => message.role === "mentor") && (
                                  <button
                                    type="button"
                                    className="book-direct-solution-button"
                                    onClick={() => void submitBookMessage("跳過理解追問，請直接依老師解析進入完整解題架構。依老師原本的行為人與罪名順序，完成爭點、判準、老師實際處理的各說、評析、正確事實涵攝及每位行為人的明確罪責結論；不得補造行為主體或題目事實。若老師認定不知情工具人無過失，須明寫欠缺注意義務違反，再檢查結果是否發生與過失未遂不罰。完成後顯示可操作的『開始考場擬答』入口，不要再提出新的反事實問題，也不要只提供擬答寫作提示。")}
                                    disabled={bookChatLoading}
                                  >
                                    跳過追問，進入完整解題
                                  </button>
                                )}
                                {simulationToolsEnabled && lawScholarReflectionEnabled && bookMessages.some((message) => message.role === "mentor") && <button type="button" className="scholar-reflection-button" onClick={() => void answerBookTeacherMessage()} disabled={bookChatLoading}><b>霸</b><span><strong>學霸怎麼想？</strong><small>本次計入陪練 1 輪</small></span></button>}
                                <button type="button" className="scholar-follow-up-button" onClick={() => void submitBookMessage()} disabled={bookChatLoading || !bookInput.trim()}>送出訊息</button>
                              </div>
                              <form className="book-dialogue-form" onSubmit={sendBookMessage}>
                                <textarea
                                  value={bookInput}
                                  onChange={(event) => setBookInput(event.target.value)}
                                  placeholder={bookSelectedMessageIndex === null ? "回答 AI 導師的問題……" : "回答指定的 AI 導師問題……"}
                                  disabled={bookChatLoading}
                                  rows={1}
                                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && bookInput.trim()) { event.preventDefault(); void submitBookMessage(); } }}
                                />
                                <button type="submit" aria-label="送出訊息" disabled={bookChatLoading || !bookInput.trim()}>↑</button>
                              </form>
                            </div>
                          </div>
                        ) : (
                          <div className="book-dialogue-empty">
                            <div>{selectedBookIsProblemSolving ? "題" : "AI"}</div>
                            <strong>
                              {selectedBookIsProblemSolving
                                ? "從左側選一個題型"
                                : "選一個章節，開始學習"}
                            </strong>
                            <p>
                              {selectedBookIsProblemSolving
                                ? "點選後，這裡會先直接顯示原書完整題目，不先上課或分析。"
                                : "這裡不開啟原始教材檔案。AI 會依教材內容先教你抓本章重點，再用問題帶你思考。"}
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  ) : (
                    <div className="course-reader">
                      <div className="course-player">
                        {youtubeEmbedUrl(
                          selectedResource.sourceUrl,
                          selectedSegment?.startSeconds ??
                            selectedProgress?.positionSeconds ??
                            0,
                        ) ? (
                          <>
                            <iframe
                              className="course-youtube-frame"
                              key={`${selectedResource.id}-${selectedSegment?.id || 0}`}
                              src={youtubeEmbedUrl(
                                selectedResource.sourceUrl,
                                selectedSegment?.startSeconds ??
                                  selectedProgress?.positionSeconds ??
                                  0,
                              )}
                              title={`${selectedResource.title}影音播放器`}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              onLoad={() => applyYoutubePlaybackRate(youtubePlaybackRate)}
                            />
                            <div className="course-video-controls">
                              <PlaybackRateSelect
                                value={youtubePlaybackRate}
                                onChange={(rate) => {
                                  setYoutubePlaybackRate(rate);
                                  applyYoutubePlaybackRate(rate);
                                }}
                              />
                            </div>
                          </>
                        ) : selectedResource.sourceUrl ? (
                          <CourseVideoPlayer
                            resourceId={selectedResource.id}
                            sourceUrl={selectedResource.sourceUrl}
                            title={`${selectedResource.title}影音播放器`}
                            startSeconds={
                              selectedSegment?.startSeconds ??
                              selectedProgress?.positionSeconds ??
                              0
                            }
                            seekToken={courseSeekToken}
                            onError={setCoursePlayerError}
                            onTimeChange={(seconds) => {
                              const currentSecond = Math.floor(seconds);
                              updateResourceProgress(selectedResource.id, {
                                positionSeconds: currentSecond,
                              });
                              const active = [...courseSummarySegments]
                                .reverse()
                                .find(
                                  (segment) =>
                                    (segment.startSeconds ??
                                      Number.POSITIVE_INFINITY) <=
                                    currentSecond,
                                );
                              if (active && active.id !== selectedSegmentId)
                                setSelectedSegmentId(active.id);
                            }}
                          />
                        ) : (
                          <div className="resource-empty">
                            這堂課尚未設定影片網址。
                          </div>
                        )}
                      </div>
                      {coursePlayerError && (
                        <div className="course-preview-error" role="alert">
                          {coursePlayerError}
                        </div>
                      )}
                      <div className="course-study-meta">
                        <div>
                          <strong>
                            {selectedSegment
                              ? "目前重點延伸"
                              : "時間點重點延伸"}
                          </strong>
                          <span>
                            {selectedSegment?.summary ||
                              (courseSummarySegments.length
                                ? `已整理 ${courseSummarySegments.length} 個時間點重點；點擊右側摘要即可跳到對應講解。`
                                : "後台尚未上傳可跳轉的時間點重點。")}
                          </span>
                        </div>
                      </div>
                      <section
                        className="course-ai-tools"
                        aria-label="課程重點延伸與截圖問 AI"
                      >
                        <div className="course-ai-shortcuts">
                          <span>接著學</span>
                          <button
                            type="button"
                            disabled={courseAiLoading}
                            onClick={() =>
                              void askCourseAi(
                                "請用白話解釋目前重點，並補一個容易理解的例子。",
                                "",
                                "白話解釋",
                              )
                            }
                          >
                            白話解釋
                          </button>
                          <button
                            type="button"
                            disabled={courseAiLoading}
                            onClick={() =>
                              void askCourseAi(
                                "請針對目前重點考我一題；先只出題，不要公布答案。",
                                "",
                                "出一題考我",
                              )
                            }
                          >
                            考我一題
                          </button>
                          <button
                            type="button"
                            disabled={courseAiLoading}
                            onClick={() =>
                              void askCourseAi(
                                "請把目前重點整理成二試申論可用的爭點、規範、涵攝與結論架構。",
                                "",
                                "整理申論架構",
                              )
                            }
                          >
                            申論架構
                          </button>
                        </div>
                        {courseAiLoading && (
                          <div
                            className="course-ai-progress"
                            role="status"
                            aria-live="polite"
                          >
                            <div className="course-ai-progress-heading">
                              <span
                                className="course-ai-spinner"
                                aria-hidden="true"
                              />
                              <div>
                                <strong>AI 正在{courseAiAction}</strong>
                                <small>請稍候，完成後會直接顯示結果</small>
                              </div>
                            </div>
                            <ol>
                              {[
                                courseCapture
                                  ? "解析圖片與畫面文字"
                                  : "讀取目前時間點與課程摘要",
                                "拆解內容與辨認核心考點",
                                "核對法律概念與作答方向",
                                "整理成清楚答案",
                              ].map((label, index) => (
                                <li
                                  key={label}
                                  className={
                                    index < courseAiStage
                                      ? "done"
                                      : index === courseAiStage
                                        ? "active"
                                        : ""
                                  }
                                >
                                  <i>
                                    {index < courseAiStage ? "✓" : index + 1}
                                  </i>
                                  <span>{label}</span>
                                  {index === courseAiStage && <em>處理中…</em>}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <div className="course-capture-row">
                          <button
                            type="button"
                            className="course-capture-button"
                            onClick={captureCourseFrame}
                            disabled={courseAiLoading}
                          >
                            截圖問 AI
                          </button>
                          <span>擷取目前畫面，連同時間點與摘要一起提問</span>
                        </div>
                        {courseCapture && (
                          <div className="course-capture-preview">
                            <img src={courseCapture} alt="目前課程畫面截圖" />
                            <button
                              type="button"
                              onClick={() => setCourseCapture("")}
                              aria-label="移除課程截圖"
                            >
                              ×
                            </button>
                          </div>
                        )}
                        <form
                          className="course-ai-form"
                          onSubmit={submitCourseQuestion}
                        >
                          <textarea
                            rows={2}
                            value={courseAiInput}
                            onChange={(event) =>
                              setCourseAiInput(event.target.value)
                            }
                            placeholder={
                              courseCapture
                                ? "這張畫面的概念是什麼？為什麼老師這樣判斷？"
                                : "針對目前重點直接問 AI…"
                            }
                            disabled={courseAiLoading}
                          />
                          <button
                            type="submit"
                            disabled={
                              courseAiLoading ||
                              (!courseAiInput.trim() && !courseCapture)
                            }
                          >
                            {courseAiLoading ? "AI 思考中…" : "送出"}
                          </button>
                        </form>
                        {courseAiNotice && (
                          <p className="course-ai-notice">{courseAiNotice}</p>
                        )}
                        {courseAiReply && (
                          <div className="course-ai-reply">
                            <strong>AI 教練</strong>
                            <p>{courseAiReply}</p>
                          </div>
                        )}
                      </section>
                      {courseSummarySegments.length > 0 && (
                        <div className="course-segment-list">
                          {courseSummarySegments.map((segment) => (
                            <button
                              key={segment.id}
                              className={
                                selectedSegment?.id === segment.id
                                  ? "active"
                                  : ""
                              }
                              onClick={() => {
                                setSelectedSegmentId(segment.id);
                                updateResourceProgress(selectedResource.id, {
                                  segmentId: segment.id,
                                  positionSeconds: segment.startSeconds || 0,
                                });
                                setCourseSeekToken((token) => token + 1);
                              }}
                            >
                              <span>
                                {segment.startSeconds != null
                                  ? formatMediaTime(segment.startSeconds)
                                  : segment.sequence}
                              </span>
                              <div>
                                <strong>{segment.title}</strong>
                                {segment.summary && (
                                  <small>{segment.summary}</small>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ) : (
                <div className="resource-empty resource-empty-large">
                  先從左側選擇一項{activeTab === "books" ? "書籍" : "影音課程"}
                  ，就在這裡開始。
                </div>
              )}
            </div>
          </section>
        )}
        {activeTab === "magazine" && (
          <section className="magazine-library" aria-label="讀法教">
            <header className="magazine-library-head">
              <div>
                <p>LAW CLASSROOM</p>
                <h2>讀法教</h2>
                <span>依年度與期數查找試讀文章，選取文字即可請 AI 解釋。</span>
              </div>
              <i>法</i>
            </header>
            <div className="magazine-library-layout">
              <aside className="magazine-index">
                <label className="magazine-search">
                  <span>搜尋文章或老師</span>
                  <input
                    value={magazineQuery}
                    onChange={(event) => setMagazineQuery(event.target.value)}
                    placeholder="輸入關鍵字、老師名稱…"
                  />
                </label>
                <nav className="magazine-years" aria-label="法學教室年度">
                  <button
                    className={
                      magazineYearFilter === "全部年度" ? "active" : ""
                    }
                    onClick={() => setMagazineYearFilter("全部年度")}
                  >
                    全部年度 <span>{magazineFeeds.length}</span>
                  </button>
                  {magazineYears.map((year) => (
                    <button
                      key={year}
                      className={magazineYearFilter === year ? "active" : ""}
                      onClick={() => setMagazineYearFilter(year)}
                    >
                      {year}
                      <span>
                        {
                          magazineFeeds.filter(
                            (magazine) => magazineYear(magazine) === year,
                          ).length
                        }
                      </span>
                    </button>
                  ))}
                </nav>
                <div className="magazine-issues">
                  {filteredMagazines.map((magazine) => (
                    <button
                      key={magazine.id}
                      className={
                        selectedMagazine?.id === magazine.id ? "active" : ""
                      }
                      onClick={() => {
                        setSelectedMagazineId(magazine.id);
                        setMagazineMessages([]);
                        setMagazineSessionId(null);
                        setMagazineSelectedText("");
                      }}
                    >
                      <strong>
                        {highlightMagazineText(
                          magazineIssueLabel(magazine.title),
                          magazineQuery,
                        )}
                      </strong>
                      <small>
                        {highlightMagazineText(magazine.title, magazineQuery)}
                      </small>
                      <span>{magazine.catalog?.length || magazine.articles?.length || 0} 筆本期內容</span>
                    </button>
                  ))}
                  {!filteredMagazines.length && <p>找不到符合的期數或文章。</p>}
                </div>
              </aside>
              <div className="magazine-reading-panel">
                {selectedMagazine ? (
                  <>
                    <header className="magazine-reading-head">
                      <div>
                        <span>{magazineYear(selectedMagazine)}</span>
                        <h3>
                          {highlightMagazineText(
                            selectedMagazine.title,
                            magazineQuery,
                          )}
                        </h3>
                        <small>
                          本期共 {selectedMagazine.catalog?.length || selectedMagazine.articles?.length || 0}{" "}
                          筆目錄內容
                        </small>
                      </div>
                      <a
                        href={selectedMagazine.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看本期來源 ↗
                      </a>
                    </header>
                    {selectedMagazine.isDraft && (
                      <p className="column-notice">
                        目前先顯示後台匯入的試讀目錄，完整分析仍由後台確認。
                      </p>
                    )}
                    {(selectedMagazine.catalog?.length ?? 0) > 0 && (
                      <div className="magazine-catalog">
                        {[...new Set(selectedMagazine.catalog?.map((item) => item.category) ?? [])].map((category) => (
                          <section className="magazine-catalog-section" key={category}>
                            <h4>【{category}】</h4>
                            {(selectedMagazine.catalog ?? []).filter((item) => item.category === category).map((item) => (
                              <article className="magazine-catalog-item" key={item.id}>
                                <div>
                                  <strong>{highlightMagazineText(item.title, magazineQuery)}</strong>
                                  {item.author ? <small>{highlightMagazineText(item.author, magazineQuery)}</small> : null}
                                  {item.content && item.category === "編輯手札" ? <p>{highlightMagazineText(item.content, magazineQuery)}</p> : null}
                                </div>
                                {item.sourceUrl && !/[?&]catalog_item=/i.test(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看公開資料 ↗</a> : <span>目錄</span>}
                              </article>
                            ))}
                          </section>
                        ))}
                      </div>
                    )}
                    <div
                      className="magazine-reading-list"
                      onMouseUp={captureMagazineSelection}
                    >
                      {(selectedMagazine.articles ?? []).map(
                        (article, index) => (
                          <article
                            className="magazine-reading-article"
                            key={article.id}
                          >
                            <div className="magazine-article-number">
                              {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="magazine-article-copy">
                              <h3>
                                {highlightMagazineText(
                                  article.title,
                                  magazineQuery,
                                )}
                              </h3>
                              {article.summary && (
                                <section className="magazine-article-summary">
                                  <b>文章摘要</b>
                                  <p>
                                    {highlightMagazineText(
                                      article.summary,
                                      magazineQuery,
                                    )}
                                  </p>
                                </section>
                              )}
                              <section className="magazine-article-issue">
                                <b>核心爭點</b>
                                <p>
                                  {highlightMagazineText(
                                    article.issue ||
                                      (article.reviewStatus === "draft"
                                        ? "尚待後台分析／發布"
                                        : "尚未擷取核心爭點"),
                                    magazineQuery,
                                  )}
                                </p>
                              </section>
                              {article.sourceUrl ? (
                                <a
                                  className="magazine-article-pdf-link"
                                  href={article.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  查看這篇試讀 PDF ↗
                                </a>
                              ) : null}
                            </div>
                          </article>
                        ),
                      )}
                    </div>
                    {magazineSelectedText && (
                      <div className="magazine-selection">
                        <div>
                          <strong>已選取文字</strong>
                          <p>{magazineSelectedText}</p>
                        </div>
                        <button type="button" onClick={useMagazineSelection}>
                          送到對話框問 AI
                        </button>
                      </div>
                    )}
                    <section className="magazine-ai">
                      <header>
                        <div>
                          <span>AI ARTICLE TUTOR</span>
                          <h3>問 AI 解釋本期內容</h3>
                        </div>
                        <small>
                          回答僅依目前顯示的標題、摘要、爭點與框選文字
                        </small>
                      </header>
                      {magazineMessages.length > 0 && (
                        <div className="magazine-ai-messages">
                          {magazineMessages.map((message, index) => (
                            <div
                              className={`magazine-ai-message ${message.role}`}
                              key={`${message.role}-${index}`}
                            >
                              <span>
                                {message.role === "mentor" ? "AI 教練" : "你"}
                              </span>
                              <p>{message.text}</p>
                            </div>
                          ))}
                          {magazineAiLoading && (
                            <div className="magazine-ai-message mentor">
                              <span>AI 教練</span>
                              <p>正在閱讀本期試讀資料…</p>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="magazine-ai-shortcuts">
                        <button
                          type="button"
                          onClick={() =>
                            setMagazineInput(
                              "請整理本期四篇文章各自的核心爭點，以及它們可能屬於哪一個法律科目。",
                            )
                          }
                        >
                          整理本期爭點
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMagazineInput(
                              "請選一篇最適合司律考生先讀的文章，說明理由，但不要補造試讀資料以外的內容。",
                            )
                          }
                        >
                          建議先讀哪篇
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMagazineInput(
                              "請把目前文章的核心爭點轉成二試申論的爭點、規範、涵攝、結論架構。",
                            )
                          }
                        >
                          轉成申論架構
                        </button>
                      </div>
                      <form onSubmit={sendMagazineMessage}>
                        <textarea
                          ref={magazineInputRef}
                          rows={3}
                          value={magazineInput}
                          onChange={(event) =>
                            setMagazineInput(event.target.value)
                          }
                          placeholder="直接問本期文章，或先框選上方文字…"
                          disabled={magazineAiLoading}
                        />
                        <button
                          type="submit"
                          disabled={magazineAiLoading || !magazineInput.trim()}
                        >
                          {magazineAiLoading ? "AI 思考中…" : "送出問題"}
                        </button>
                      </form>
                      {magazineAiNotice && (
                        <p className="magazine-ai-notice">{magazineAiNotice}</p>
                      )}
                    </section>
                  </>
                ) : (
                  <div className="magazine-empty">
                    後台尚未發布法學教室期數。
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
        {activeTab === "calendar" && (
          <>
            <div className="calendar-toolbar">
              <button onClick={() => moveMonth(-1)}>‹</button>
              <strong>{month.replace("-", " 年 ")} 月</strong>
              <button onClick={() => moveMonth(1)}>›</button>
            </div>
            <div className="calendar-grid">
              {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
                <div className="weekday" key={day}>
                  {day}
                </div>
              ))}
              {days.map((day, index) => (
                <div
                  className={`calendar-day ${day ? "" : "blank"} ${day && selectedCalendarDate === dateFor(day) ? "selected" : ""}`}
                  key={`${day}-${index}`}
                  onClick={() => day && setSelectedCalendarDate(dateFor(day))}
                  onDoubleClick={() => day && openNew(day)}
                >
                  {day && (
                    <>
                      <span className="day-number">{day}</span>
                      {tasks.some((task) => task.taskDate === dateFor(day)) && (
                        <span className="mobile-task-count" aria-label={`${tasks.filter((task) => task.taskDate === dateFor(day)).length} 項任務`}>
                          {tasks.filter((task) => task.taskDate === dateFor(day)).length}
                        </span>
                      )}
                      <div className="day-tasks">
                        {tasks
                          .filter((task) => task.taskDate === dateFor(day))
                          .map((task) => (
                            <div
                              className={`calendar-task ${task.status === "completed" ? "done" : ""}`}
                              key={task.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                openTask(task);
                              }}
                            >
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggle(task);
                                }}
                                aria-label="切換完成狀態"
                              >
                                {task.status === "completed" ? "✓" : ""}
                              </button>
                              <div>
                                <strong>{task.subject}</strong>
                                <span>{task.title}</span>
                                <small>{task.durationMinutes} 分鐘</small>
                              </div>
                            </div>
                          ))}
                      </div>
                      <button className="day-add" onClick={(event) => { event.stopPropagation(); openNew(day); }}>
                        ＋
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <section className="mobile-calendar-agenda" aria-live="polite">
              <header>
                <div>
                  <span>所選日期</span>
                  <h2>{Number(selectedCalendarDate.slice(5, 7))} 月 {Number(selectedCalendarDate.slice(8, 10))} 日</h2>
                </div>
                <b>{selectedCalendarTasks.length} 項任務</b>
              </header>
              {selectedCalendarTasks.length ? (
                <div className="mobile-agenda-list">
                  {selectedCalendarTasks.map((task) => (
                    <article className={task.status === "completed" ? "done" : ""} key={task.id}>
                      <button className="mobile-agenda-main" onClick={() => openTask(task)}>
                        <span>{task.subject}・{task.durationMinutes} 分鐘</span>
                        <strong>{task.title}</strong>
                        <small>{task.details || "點開查看或開始這項學習任務"}</small>
                        <em>查看內容 ›</em>
                      </button>
                      <button className="mobile-agenda-toggle" onClick={() => void toggle(task)}>
                        {task.status === "completed" ? "✓ 已完成（點此取消）" : "○ 標記完成"}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mobile-agenda-empty">
                  <p>這一天還沒有安排任務。</p>
                  <button onClick={() => openNew(Number(selectedCalendarDate.slice(8, 10)))}>＋ 新增這天任務</button>
                </div>
              )}
            </section>
          </>
        )}
        {activeTab === "practice" && <PracticeLab initialType="mcq" standalone canAdmin={currentMember?.canAdmin === true} />}
        {activeTab === "laws" && <LegalResearchTabs />}
        {activeTab === "records" && (
          <section className="learning-hub tab-hub" id="records">
            <div className="hub-heading">
              <div>
                <p>LEARNING HISTORY</p>
                <h2>學習紀錄</h2>
                <span>
                  完成讀書任務與一試練題後會自動寫入，也保留實際時間、弱點與下次接續點。
                </span>
              </div>
              <strong>{records.length} 筆</strong>
            </div>
            <section className={`learning-coach-card ${learningAnalysis ? "is-analyzed" : ""}`} aria-label="AI 教練學習診斷">
              <div className="learning-coach-head">
                <div>
                  <p>AI COACH DIAGNOSIS</p>
                  <h3>AI 教練學習診斷</h3>
                  <span>不只記下你做過什麼，也判斷目前最值得補強的地方。</span>
                </div>
                <button type="button" className="learning-coach-analyze" onClick={() => void analyzeLearning()} disabled={learningAnalysisLoading}>
                  {learningAnalysisLoading ? "分析中…" : learningAnalysis ? "重新分析" : "開始分析"}
                </button>
              </div>
              <div className="learning-coach-status">
                <span className="learning-coach-status-dot" />
                <strong>{coachData.statusLabel}</strong>
                <span>{learningAnalysis?.isStale ? "學習紀錄已更新，這是上次保存的診斷" : learningAnalysis ? "已保存，可下次繼續查看" : "先看初步狀況，點擊分析取得完整診斷"}</span>
              </div>
              <p className="learning-coach-summary">{coachData.summary}</p>
              <div className="learning-snapshot" aria-label="學習狀況圖表">
                <div className="learning-snapshot-head">
                  <b>學習狀況一眼看懂</b>
                  <span>依目前保存的學習紀錄</span>
                </div>
                <div className="learning-snapshot-metrics">
                  <div>
                    <span>累積學習</span>
                    <strong>{learningSnapshot.totalMinutes}<small> 分鐘</small></strong>
                  </div>
                  <div>
                    <span>作答表現</span>
                    <strong>{learningSnapshot.accuracy === null ? "尚無" : `${learningSnapshot.accuracy}%`}</strong>
                    <small>{learningSnapshot.answered ? `${learningSnapshot.correct}／${learningSnapshot.answered} 題答對` : "還沒有作答紀錄"}</small>
                  </div>
                  <div>
                    <span>紀錄筆數</span>
                    <strong>{records.length}<small> 筆</small></strong>
                  </div>
                </div>
                {records.length > 0 ? (
                  <div className="learning-snapshot-charts">
                    <div className="learning-mini-chart">
                      <div className="learning-mini-chart-head"><b>各科投入時間</b><span>分鐘</span></div>
                      <div className="learning-bars">
                        {learningSnapshot.subjectsByMinutes.map(([subject, minutes]) => (
                          <div className="learning-bar-row" key={subject}>
                            <span>{subject}</span>
                            <div className="learning-bar-track"><i style={{ width: `${Math.max(8, Math.round((minutes / learningSnapshot.maxSubjectMinutes) * 100))}%` }} /></div>
                            <strong>{minutes}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="learning-mini-chart">
                      <div className="learning-mini-chart-head"><b>作答結果</b><span>{learningSnapshot.answered ? "已作答題目" : "尚無作答"}</span></div>
                      {learningSnapshot.answered ? (
                        <>
                          <div className="learning-answer-track" aria-label={`答對 ${learningSnapshot.correct} 題、答錯 ${learningSnapshot.incorrect} 題`}>
                            <i className="is-correct" style={{ width: `${(learningSnapshot.correct / learningSnapshot.answered) * 100}%` }} />
                            <i className="is-incorrect" style={{ width: `${(learningSnapshot.incorrect / learningSnapshot.answered) * 100}%` }} />
                          </div>
                          <div className="learning-answer-legend">
                            <span><i className="is-correct" />答對 {learningSnapshot.correct}</span>
                            <span><i className="is-incorrect" />答錯 {learningSnapshot.incorrect}</span>
                            {learningSnapshot.unanswered > 0 && <span><i className="is-unanswered" />未作答 {learningSnapshot.unanswered}</span>}
                          </div>
                        </>
                      ) : <p className="learning-chart-empty">先完成一試練題，這裡會顯示答題表現。</p>}
                    </div>
                    {learningSnapshot.weaknesses.length > 0 && (
                      <div className="learning-mini-chart learning-weakness-chart">
                        <div className="learning-mini-chart-head"><b>紀錄中的弱點</b><span>出現次數</span></div>
                        <div className="learning-bars">
                          {learningSnapshot.weaknesses.map(([weakness, count]) => (
                            <div className="learning-bar-row" key={weakness}>
                              <span title={weakness}>{weakness}</span>
                              <div className="learning-bar-track is-warm"><i style={{ width: `${Math.max(10, Math.round((count / learningSnapshot.weaknesses[0][1]) * 100))}%` }} /></div>
                              <strong>{count}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : <div className="learning-chart-empty">完成讀書任務或練題後，這裡會自動整理成簡單圖表。</div>}
              </div>
              {!learningAnalysis && <div className="learning-coach-next"><b>下一步</b><span>{coachData.nextAction}</span></div>}
              {learningAnalysis && (
                <div className="learning-coach-analysis">
                  <div className="learning-coach-columns">
                    <div>
                      <b>目前做得不錯</b>
                      <ul>{coachData.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div className="learning-coach-gaps">
                      <b>教練看到的缺口</b>
                      <ul>{coachData.gaps.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                  <div className="learning-coach-next"><b>今天建議先做</b><span>{coachData.nextAction}</span></div>
                  {coachData.recommendations.length > 0 && (
                    <div className="learning-coach-recommendations">
                      <div className="learning-coach-recommendations-head"><b>可以再加強的內容</b><span>依弱點與近期紀錄排序</span></div>
                      {coachData.recommendations.map((item) => (
                        <article key={`${item.segmentId ?? item.title}-${item.location}`}>
                          <div>
                            <span>{item.type}</span>
                            <strong>{item.title}</strong>
                            {item.location && <small>{item.location}</small>}
                            <p>{item.reason}。{item.action}。</p>
                          </div>
                          <button type="button" onClick={() => openLearningRecommendation(item)}>前往補強</button>
                        </article>
                      ))}
                    </div>
                  )}
                  <footer className="learning-coach-meta">
                    <span>{coachData.model} · {coachData.generatedAt ? `分析於 ${coachData.generatedAt}` : "剛剛完成"}{learningAnalysis?.saved ? " · 已保存" : ""}</span>
                    {showAnalysisCost && coachData.usage && <span>Token {(coachData.usage.inputTokens + coachData.usage.outputTokens).toLocaleString()} · 約 US$ {coachData.usage.estimatedCostUsd.toFixed(4)} · 約 NT$ {formatTwd(coachData.usage.estimatedCostUsd)}</span>}
                  </footer>
                </div>
              )}
              {learningAnalysisNotice && <div className="learning-coach-notice">{learningAnalysisNotice}</div>}
            </section>
            <div className="record-entry">
              <select
                value={recordDraft.subject}
                onChange={(event) =>
                  setRecordDraft({
                    ...recordDraft,
                    subject: event.target.value,
                  })
                }
              >
                {subjects.map((subject) => (
                  <option key={subject}>{subject}</option>
                ))}
              </select>
              <input
                value={recordDraft.title}
                onChange={(event) =>
                  setRecordDraft({ ...recordDraft, title: event.target.value })
                }
                placeholder="今天實際學了什麼？"
              />
              <input
                type="number"
                min="0"
                max="720"
                value={recordDraft.actualMinutes}
                onChange={(event) =>
                  setRecordDraft({
                    ...recordDraft,
                    actualMinutes: Number(event.target.value),
                  })
                }
                aria-label="實際分鐘"
              />
              <input
                value={recordDraft.weakness}
                onChange={(event) =>
                  setRecordDraft({
                    ...recordDraft,
                    weakness: event.target.value,
                  })
                }
                placeholder="發現的弱點（可不填）"
              />
              <input
                value={recordDraft.nextStep}
                onChange={(event) =>
                  setRecordDraft({
                    ...recordDraft,
                    nextStep: event.target.value,
                  })
                }
                placeholder="下次從哪裡接續？"
              />
              <button onClick={addRecord}>補登紀錄</button>
            </div>
            {records.length > 0 && <div className="record-batch-toolbar">
              <label><input type="checkbox" checked={allVisibleRecordsSelected} onChange={toggleAllVisibleRecords} /> 全選本頁</label>
              <span>已選 {selectedRecordIds.size} 筆</span>
              <button type="button" onClick={() => void deleteSelectedRecords()} disabled={!selectedRecordIds.size || deletingRecords}>{deletingRecords ? "刪除中…" : "刪除選取紀錄"}</button>
            </div>}
            {visibleRecords.length ? (
              <div className="record-list">
                {visibleRecords.map((record) => {
                  const expanded = expandedRecordIds.has(record.id);
                  return (
                  <article key={record.id} className={expanded ? "is-expanded" : ""}>
                    <input type="checkbox" checked={selectedRecordIds.has(record.id)} onChange={() => toggleRecord(record.id)} aria-label={`選取 ${record.subject} ${record.title}`} />
                    <time>{record.recordDate}</time>
                    <div className="record-content">
                      <button
                        type="button"
                        className="record-title-button"
                        onClick={() => toggleRecordDetails(record.id)}
                        aria-expanded={expanded}
                        aria-controls={`record-details-${record.id}`}
                      >
                      <strong>
                        {record.subject} · {record.title}
                      </strong>
                      <span className="record-expand-label">{expanded ? "收合完整紀錄" : "查看完整紀錄"}<span aria-hidden="true">⌄</span></span>
                      </button>
                      <span>
                        {record.activityType} · 實際 {record.actualMinutes} 分鐘
                        {record.correct === null
                          ? ""
                          : record.correct
                            ? " · 答對"
                            : " · 待補強"}
                      </span>
                      {!expanded && record.weakness && (
                        <small>弱點：{record.weakness}</small>
                      )}
                      {!expanded && record.nextStep && (
                        <small>下次接續：{record.nextStep}</small>
                      )}
                      {expanded && (
                        <div className="record-details" id={`record-details-${record.id}`}>
                          <div><b>完整學習內容</b><p>{record.reflection || record.title}</p></div>
                          {record.weakness && <div><b>發現的弱點</b><p>{record.weakness}</p></div>}
                          {record.nextStep && <div><b>下次接續</b><p>{record.nextStep}</p></div>}
                          {!record.reflection && !record.weakness && !record.nextStep && <p className="record-empty-detail">這筆紀錄目前只有學習項目與時間。</p>}
                        </div>
                      )}
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="hub-empty">
                完成第一項任務、練完第一題或手動補登後，紀錄會出現在這裡。
              </div>
            )}
            {records.length > 10 && (
              <nav className="document-pagination">
                <button
                  disabled={recordPage === 1}
                  onClick={() => setRecordPage((page) => page - 1)}
                >
                  上一頁
                </button>
                <span>
                  第 {recordPage} / {Math.ceil(records.length / 10)} 頁
                </span>
                <button
                  disabled={recordPage >= Math.ceil(records.length / 10)}
                  onClick={() => setRecordPage((page) => page + 1)}
                >
                  下一頁
                </button>
              </nav>
            )}
          </section>
        )}
        {activeTab === "conversations" && (
          <section className="learning-hub tab-hub" id="conversations">
            <div className="hub-heading">
              <div>
                <p>DAILY CONVERSATIONS</p>
                <h2>每日對話</h2>
                <span>
                  每天一個新對話；昨天的內容會保留，並成為今天 AI
                  教練的接續依據。
                </span>
              </div>
              <strong>{chatDays.length} 天</strong>
            </div>
            {chatDays.length ? (
              <div className="daily-chat-list">
                {chatDays.map((day) => (
                  <article className="daily-chat-card" key={day.id}>
                    <button
                      type="button"
                      className="daily-chat-summary"
                      onClick={() =>
                        setOpenChatDay(openChatDay === day.id ? null : day.id)
                      }
                    >
                      <span>{day.date}</span>
                      <div>
                        <strong>
                          {day.title.replace(/^\d{4}-\d{2}-\d{2}｜/, "") ||
                            "司律備考學習對話"}
                        </strong>
                        <small>
                          {day.messageCount} 則訊息 ·{" "}
                          {day.progressStatus === "active"
                            ? "已進行"
                            : "已保存"}
                        </small>
                      </div>
                      <b>{openChatDay === day.id ? "收合" : "查看"}</b>
                    </button>
                    {openChatDay === day.id && (
                      <div className="daily-chat-messages">
                        {day.messages.map((message, index) => (
                          <div
                            className={`daily-chat-message ${message.role}`}
                            key={`${day.id}-${index}`}
                          >
                            <span>
                              {message.role === "mentor" ? "AI 教練" : "我"}
                            </span>
                            <p>{message.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="hub-empty">
                今天開始對話後，每日紀錄會自動保留在這裡。
              </div>
            )}
          </section>
        )}
        {activeTab === "exam-conversations" && (
          <section className="learning-hub tab-hub" id="exam-conversations">
            <div className="hub-heading">
              <div>
                <p>QUESTION COACH HISTORY</p>
                <h2>試題問答</h2>
                <span>
                  一試、二試在題目內的 AI 對話會依題目保存，之後可回看學習。
                </span>
              </div>
              <strong>{examConversations.length} 題</strong>
            </div>
            {examConversations.length ? (
              <div className="daily-chat-list">
                {examConversations.map((conversation) => (
                  <article
                    className="daily-chat-card"
                    key={conversation.questionId}
                  >
                    <button
                      type="button"
                      className="daily-chat-summary"
                      onClick={() =>
                        setOpenExamConversation(
                          openExamConversation === conversation.questionId
                            ? null
                            : conversation.questionId,
                        )
                      }
                    >
                      <span>{conversation.year}</span>
                      <div>
                        <strong>
                          {conversation.subject} · 第{" "}
                          {conversation.questionNumber} 題
                        </strong>
                        <small>{conversation.messages.length} 則問答</small>
                      </div>
                      <b>
                        {openExamConversation === conversation.questionId
                          ? "收合"
                          : "查看"}
                      </b>
                    </button>
                    {openExamConversation === conversation.questionId && (
                      <div className="daily-chat-messages">
                        <p className="exam-history-stem">{conversation.stem}</p>
                        {conversation.messages.map((message) => (
                          <div
                            className={`daily-chat-message ${message.role}`}
                            key={message.id}
                          >
                            <span>
                              {message.role === "mentor" ? "AI 教練" : "我"}
                            </span>
                            <p>{message.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="hub-empty">
                在試題卡片內開始 AI 對話後，紀錄會自動保留在這裡。
              </div>
            )}
          </section>
        )}
        {activeTab === "notes" && (
          <section className="learning-hub tab-hub" id="notes">
            <div className="hub-heading">
              <div>
                <p>MY COLLECTION</p>
                <h2>筆記收藏</h2>
                <span>
                  從導師對話一鍵收藏，保留教材來源並可依科目、標籤與內容搜尋。
                </span>
              </div>
              <div className="hub-heading-actions">
                <strong>{notes.length} 則</strong>
                <button
                  className="secondary-btn"
                  onClick={() => void addBlankNote()}
                >
                  ＋ 空白筆記
                </button>
              </div>
            </div>
            <input
              className="note-search"
              value={noteQuery}
              onChange={(event) => {
                setNoteQuery(event.target.value);
                setNotePage(1);
              }}
              placeholder="搜尋筆記、科目或標籤…"
            />
            {visibleNotes.length ? (
              <div className="note-list">
                {visibleNotes.map((note) => (
                  <article key={note.id} onClick={() => setNoteDraft(note)}>
                    <div>
                      <span>{note.subject}</span>
                      {note.tags && <em>{note.tags}</em>}
                      <button type="button" onClick={(event) => { event.stopPropagation(); setNoteDraft(note); }}>編輯</button>
                    </div>
                    <strong>{note.title}</strong>
                    <p>{note.content}</p>
                    {note.attachments?.map((attachment) => (
                      <button type="button" className="note-attachment-zoom" key={attachment.id} onClick={(event) => { event.stopPropagation(); setLightboxImage({ url: attachment.url, alt: "筆記課程截圖" }); }} aria-label="放大筆記課程截圖"><img className="note-attachment-preview" src={attachment.url} alt="筆記課程截圖" loading="lazy" /></button>
                    ))}
                    {note.sourceLabel && (
                      <small>教材來源：{note.sourceLabel}</small>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="hub-empty">
                尚未收藏筆記。回到對話後，按下 AI
                回答下方的「收藏筆記」即可加入。
              </div>
            )}
            {filteredNotes.length > 10 && (
              <nav className="document-pagination">
                <button
                  disabled={notePage === 1}
                  onClick={() => setNotePage((page) => page - 1)}
                >
                  上一頁
                </button>
                <span>
                  第 {notePage} / {Math.ceil(filteredNotes.length / 10)} 頁
                </span>
                <button
                  disabled={notePage >= Math.ceil(filteredNotes.length / 10)}
                  onClick={() => setNotePage((page) => page + 1)}
                >
                  下一頁
                </button>
              </nav>
            )}
          </section>
        )}
      </div>
      {draft && (
        <div className="editor-backdrop" onClick={() => setDraft(null)}>
          <section
            className="task-editor"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-title">
              <h2>{draft.id ? "編輯讀書任務" : "新增讀書任務"}</h2>
              <button onClick={() => setDraft(null)}>×</button>
            </div>
            <label className="field">
              日期
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label className="field">
              科目
              <select
                value={draft.subject}
                onChange={(e) =>
                  setDraft({ ...draft, subject: e.target.value })
                }
              >
                {subjects.map((subject) => (
                  <option key={subject}>{subject}</option>
                ))}
              </select>
            </label>
            <label className="field">
              任務名稱
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="例如：不作為犯基本觀念"
              />
            </label>
            <label className="field">
              預計時間（分鐘）
              <input
                type="number"
                min="10"
                max="480"
                value={draft.durationMinutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationMinutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              學習內容
              <textarea
                value={draft.details}
                onChange={(e) =>
                  setDraft({ ...draft, details: e.target.value })
                }
                rows={4}
              />
            </label>
            <label className="complete-check">
              <input
                type="checkbox"
                checked={draft.status === "completed"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.checked ? "completed" : "pending",
                  })
                }
              />
              已完成
            </label>
            {message && <p className="editor-message">{message}</p>}
            <div className="editor-actions">
              {draft.id && (
                <button className="delete-task" onClick={remove}>
                  刪除
                </button>
              )}
              <button className="primary-btn" onClick={save}>
                儲存任務
              </button>
            </div>
          </section>
        </div>
      )}
      {noteDraft && (
        <div className="editor-backdrop" onClick={() => setNoteDraft(null)}>
          <section
            className="task-editor note-editor"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-title">
              <h2>編輯筆記</h2>
              <button onClick={() => setNoteDraft(null)}>×</button>
            </div>
            <label className="field">
              標題
              <input
                value={noteDraft.title}
                onChange={(e) =>
                  setNoteDraft({ ...noteDraft, title: e.target.value })
                }
              />
            </label>
            <label className="field">
              科目
              <select
                value={noteDraft.subject}
                onChange={(e) =>
                  setNoteDraft({ ...noteDraft, subject: e.target.value })
                }
              >
                {subjects.map((subject) => (
                  <option key={subject}>{subject}</option>
                ))}
              </select>
            </label>
            <label className="field">
              標籤
              <input
                value={noteDraft.tags}
                onChange={(e) =>
                  setNoteDraft({ ...noteDraft, tags: e.target.value })
                }
                placeholder="重要、待複習…"
              />
            </label>
            <label className="field">
              筆記內容
              <textarea
                value={noteDraft.content}
                onChange={(e) =>
                  setNoteDraft({ ...noteDraft, content: e.target.value })
                }
                rows={9}
              />
            </label>
            {noteDraft.sourceLabel && (
              <p className="note-source-readonly">
                教材來源：{noteDraft.sourceLabel}
              </p>
            )}
            {noteDraft.attachments?.map((attachment) => (
              <button type="button" className="note-editor-attachment-button" key={attachment.id} onClick={() => setLightboxImage({ url: attachment.url, alt: "筆記課程截圖" })} aria-label="放大筆記課程截圖"><img className="note-editor-attachment" src={attachment.url} alt="筆記課程截圖" /></button>
            ))}
            <div className="editor-actions">
              <button className="delete-task" onClick={removeNote}>
                刪除筆記
              </button>
              <button className="primary-btn" onClick={saveNote}>
                儲存筆記
              </button>
            </div>
          </section>
        </div>
      )}
      {lightboxImage && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="放大圖片" onClick={() => setLightboxImage(null)}>
          <button type="button" className="image-lightbox-close" onClick={() => setLightboxImage(null)} aria-label="關閉圖片">×</button>
          <img src={lightboxImage.url} alt={lightboxImage.alt} onClick={(event) => event.stopPropagation()} />
          <p>點擊外部或按 Esc 關閉</p>
        </div>
      )}
      {resetPlanOpen && (
        <div
          className="editor-backdrop"
          onClick={() => !resetPlanLoading && setResetPlanOpen(false)}
        >
          <section
            className="task-editor reset-plan-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-title">
              <div>
                <p>AI STUDY PLANNER</p>
                <h2>
                  {resetPlanDraft.step === "preview"
                    ? "確認新的讀書計畫"
                    : "想怎麼重新規劃？"}
                </h2>
              </div>
              <button
                disabled={resetPlanLoading}
                onClick={() => setResetPlanOpen(false)}
              >
                ×
              </button>
            </div>
            {resetPlanDraft.step === "settings" ? (
              <>
                <div className="planner-mode">
                  <button
                    className={resetPlanDraft.mode === "all" ? "active" : ""}
                    onClick={() =>
                      setResetPlanDraft({
                        ...resetPlanDraft,
                        mode: "all",
                        clearScope: "all",
                      })
                    }
                  >
                    <strong>全科備考</strong>
                    <span>AI 依弱點分配各科比重</span>
                  </button>
                  <button
                    className={resetPlanDraft.mode === "single" ? "active" : ""}
                    onClick={() =>
                      setResetPlanDraft({
                        ...resetPlanDraft,
                        mode: "single",
                        clearScope: "subject",
                      })
                    }
                  >
                    <strong>單科專攻</strong>
                    <span>集中學好一個法律科目</span>
                  </button>
                </div>
                {resetPlanDraft.mode === "single" && (
                  <div className="reset-plan-fields planner-subject-fields">
                    <label className="field">
                      選擇法律
                      <select
                        value={resetPlanDraft.subject}
                        onChange={(event) => {
                          const subject = event.target.value;
                          setResetPlanDraft({
                            ...resetPlanDraft,
                            subject,
                            scope: "全科",
                          });
                        }}
                      >
                        {planningSubjects.map((subject) => (
                          <option key={subject}>{subject}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      學習範圍
                      <select
                        value={resetPlanDraft.scope}
                        onChange={(event) =>
                          setResetPlanDraft({
                            ...resetPlanDraft,
                            scope: event.target.value,
                          })
                        }
                      >
                        {(
                          subjectScopes[resetPlanDraft.subject] ?? ["全科"]
                        ).map((scope) => (
                          <option key={scope}>{scope}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="reset-plan-fields">
                  <label className="field">
                    目前程度
                    <select
                      value={resetPlanDraft.level}
                      onChange={(event) =>
                        setResetPlanDraft({
                          ...resetPlanDraft,
                          level: event.target.value as ResetPlanDraft["level"],
                        })
                      }
                    >
                      <option>初學</option>
                      <option>有基礎</option>
                      <option>進階</option>
                    </select>
                  </label>
                  <label className="field">
                    每日可用時間（分鐘）
                    <input
                      type="number"
                      min="30"
                      max="720"
                      step="30"
                      value={resetPlanDraft.dailyMinutes}
                      onChange={(event) =>
                        setResetPlanDraft({
                          ...resetPlanDraft,
                          dailyMinutes: Math.max(
                            30,
                            Number(event.target.value) || 30,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    規劃期間
                    <select
                      value={resetPlanDraft.days}
                      onChange={(event) =>
                        setResetPlanDraft({
                          ...resetPlanDraft,
                          days: Number(event.target.value),
                        })
                      }
                    >
                      <option value={7}>接下來 7 天</option>
                      <option value={14}>接下來 14 天</option>
                      <option value={30}>接下來 30 天</option>
                    </select>
                  </label>
                  {resetPlanDraft.mode === "single" && (
                    <label className="field">
                      原行程處理
                      <select
                        value={resetPlanDraft.clearScope}
                        onChange={(event) =>
                          setResetPlanDraft({
                            ...resetPlanDraft,
                            clearScope: event.target
                              .value as ResetPlanDraft["clearScope"],
                          })
                        }
                      >
                        <option value="subject">
                          只清除並重排{resetPlanDraft.subject}
                        </option>
                        <option value="all">清空整張行事曆</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="planner-choice">
                  <strong>學習目標</strong>
                  <div>
                    {planningGoals.map((goal) => (
                      <button
                        key={goal}
                        className={
                          resetPlanDraft.goals.includes(goal) ? "active" : ""
                        }
                        onClick={() => togglePlanningItem("goals", goal)}
                      >
                        {goal}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="planner-choice">
                  <strong>納入學習內容</strong>
                  <div>
                    {planningResources.map((resource) => (
                      <button
                        key={resource}
                        className={
                          resetPlanDraft.resources.includes(resource)
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          togglePlanningItem("resources", resource)
                        }
                      >
                        {resource}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="editor-actions">
                  <button
                    className="secondary-btn"
                    onClick={() => setResetPlanOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    className="planner-next-btn"
                    disabled={
                      !resetPlanDraft.goals.length ||
                      !resetPlanDraft.resources.length
                    }
                    onClick={() =>
                      setResetPlanDraft({ ...resetPlanDraft, step: "preview" })
                    }
                  >
                    預覽規劃摘要
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="planner-summary">
                  <span>
                    {resetPlanDraft.mode === "single" ? "單科專攻" : "全科備考"}
                  </span>
                  <h3>
                    {resetPlanDraft.mode === "single"
                      ? `${resetPlanDraft.subject}｜${resetPlanDraft.scope}`
                      : "司律全科讀書計畫"}
                  </h3>
                  <p>
                    {resetPlanDraft.days} 天｜每天 {resetPlanDraft.dailyMinutes}{" "}
                    分鐘｜{resetPlanDraft.level}
                  </p>
                  <dl>
                    <div>
                      <dt>學習目標</dt>
                      <dd>{resetPlanDraft.goals.join("、")}</dd>
                    </div>
                    <div>
                      <dt>學習內容</dt>
                      <dd>{resetPlanDraft.resources.join("、")}</dd>
                    </div>
                    <div>
                      <dt>行程處理</dt>
                      <dd>
                        {resetPlanDraft.mode === "single" &&
                        resetPlanDraft.clearScope === "subject"
                          ? `只清除目前的${resetPlanDraft.subject}任務，其他科目保留`
                          : "清空目前行事曆任務後重新安排"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="reset-plan-warning">
                  <strong>學習成果不會被刪除</strong>
                  <p>
                    已完成的學習紀錄、作答結果、弱點分析、每日對話與筆記都會保留，並提供給
                    AI 作為重排依據。
                  </p>
                </div>
                {resetPlanMessage && (
                  <p
                    className={`reset-plan-message ${resetPlanMessage.includes("已替換") ? "success" : ""}`}
                  >
                    {resetPlanMessage}
                  </p>
                )}
                <div className="editor-actions">
                  <button
                    className="secondary-btn"
                    disabled={resetPlanLoading}
                    onClick={() =>
                      setResetPlanDraft({ ...resetPlanDraft, step: "settings" })
                    }
                  >
                    返回修改
                  </button>
                  <button
                    className="reset-confirm-btn"
                    disabled={resetPlanLoading}
                    onClick={() => void clearAndReplan()}
                  >
                    {resetPlanLoading ? "AI 正在規劃…" : "確認並建立計畫"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
