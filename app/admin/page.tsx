Warning: truncated output (original token count: 94471)
Total output lines: 6622

"use client";

import Link from "next/link";
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { unzip, unzipSync } from "fflate";
import { formatMagazineAnalysis, parseMagazineAnalysis } from "../../lib/magazine";
import { collectLawObjects, compactLegalRecord, legalCategory, parseLegalXml, type LegalArchiveEntry } from "../../lib/legal-parser";
import { USD_TO_TWD_RATE, formatTwd } from "../../lib/currency";
import { documentDisplayTitle, normalizeDocumentTitle } from "../../lib/document-title";
import CourseVideoPlayer, { formatMediaTime } from "../course-video-player";
import SitesCloudflareSyncDownload from "./SitesCloudflareSyncDownload";
import LocalNodeJobsPanel from "./LocalNodeJobsPanel";
import DocumentIndexHealthPanel from "./DocumentIndexHealthPanel";

type PaymentOrderRow = { orderId: string; transactionId: string | null; packageName: string; amount: number; currency: string; status: string; environment: string; paidAt: string | null; activatedAt: string | null; createdAt: string };
type MemberRow = { id: number; email: string; displayName: string; role: "teacher" | "student"; canAdmin: boolean; status: "active" | "disabled"; className: string; lastSeenAt: string | null; createdAt: string; passwordResetRequestedAt?: string | null; accesses?: Array<{ memberId: number; examCategory: string; status: string; canAdmin: boolean; className: string }>; paymentOrders?: PaymentOrderRow[] };
type MemberDeletionAudit = { id: number; deletionRef: string; actorType: string; requestChannel: string; authenticationMethod: string; outcome: string; retainedPaymentOrders: number; paymentDataAnonymized: boolean; learningDataDeleted: boolean; requestedAt: string; completedAt: string | null };
type ExternalBookData = { authors?: string[]; edition?: string; publishedAt?: string; isbn?: string; bookCode?: string; description?: string; catalogue?: string[]; completeness?: number };
type ExternalIndexSource = { id: number; key: "lawdata" | "angle_books" | "angle_media" | "get" | "ibrain"; label: string; sourceUrl: string; status: string; lastSyncedAt: string | null; items: Array<{ id: number; title: string; url: string; summary: string; enabled: boolean; indexed: boolean; accessType: string; depth?: number; parentTitle?: string; kind?: string; subject?: string; teacher?: string; content?: string; publicLinks?: Array<{ label: string; url: string }>; book?: ExternalBookData }> };
type ExternalRetrievalMatch = { id: number; source: string; title: string; summary: string; parentTitle: string; depth: number; enabled: boolean; indexed: boolean; excerpt: string };
type ExternalRetrievalTest = { query: string; mode: "children" | "single"; found: boolean; complete: boolean; failureReason: string; stats: { total: number; complete: number; titleOnly: number; missing: number; disabled: number }; hierarchy: { categories: number; issues: number; articles: number; unresolved: number }; target: { id: number; title: string; enabled: boolean; indexed: boolean; parentTitle: string }; tests: Array<{ id: number; title: string; parentTitle: string; depth: number; dataType: "category" | "issue" | "article" | "unresolved"; enabled: boolean; indexed: boolean; found: boolean; complete: boolean; failureReason: string; matches: ExternalRetrievalMatch[] }>; matches: ExternalRetrievalMatch[] };

type Uploaded = {
  id: number;
  name: string;
  bookTitle?: string;
  examCategory?: string;
  subject: string;
  size: string;
  status: string;
  type?: string;
  processingStage?: string;
  processingMessage?: string;
  pageCount?: number | null;
  extractedChars?: number;
  chapterCount?: number;
  topicCount?: number;
  questionCount?: number;
  tags?: string[];
  fullTextIndexed?: boolean;
  vectorIndexed?: boolean;
  homepageSearchEnabled?: boolean;
  fineSearchUnitCount?: number;
  assignmentCount?: number;
  assignmentCategories?: string[];
  summary?: string;
  sourceFileName?: string;
  indexedFileName?: string;
  extractionNote?: string;
  analysisStatus?: string;
  chapters?: Array<{ title?: string; path?: string; page_start?: number | null; page_end?: number | null }>;
  questions?: Array<{ number?: string; title?: string; content_type?: string; chapter?: string }>;
  error?: string | null;
};
type QuestionBankSummary = {
  totals: Array<{ examCategory: string; total: number; published: number; draft: number; reviewed: number }>;
  files: Array<{ id: number; examCategory: string; bookTitle: string; fileName: string; subject: string; documentType: string; status: string; pageCount: number; questionCount: number; processedAt: string | null }>;
  urlSources: Array<{ id: number; examCategory: string; label: string; url: string; examType: string; sourceKind: string; status: string; discoveredCount: number; processedCount: number; questionCount: number; lastError: string | null }>;
  questions?: Array<{ id: number; examCategory: string; examType: string; year: string; examName: string; subject: string; questionNumber: string; stem: string; status: string; reviewStatus: string }>;
  subjects?: string[];
  years?: string[];
  packages?: Array<{ key: string; name: string; examCategory: string; description: string; questionIds: number[]; questionCount: number; status: string; createdAt: string }>;
};

function highlightQuestionText(text: string, query: string) {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return text.split(pattern).map((part, index) => terms.some((term) => part.toLowerCase() === term.toLowerCase())
    ? <mark className="question-search-highlight" key={`${part}-${index}`}>{part}</mark>
    : <Fragment key={`${part}-${index}`}>{part}</Fragment>);
}
type DocumentApiRow = {
  id: number;
  name: string;
  bookTitle?: string;
  examCategory?: string;
  subject: string;
  type: string;
  sizeBytes: number;
  status: string;
  processingStage?: string;
  processingMessage?: string;
  pageCount?: number | null;
  extractedChars?: number;
  chapterCount?: number;
  topicCount?: number;
  questionCount?: number;
  tags?: string[];
  fullTextIndexed?: boolean;
  vectorIndexed?: boolean;
  homepageSearchEnabled?: boolean;
  fineSearchUnitCount?: number;
  assignmentCount?: number;
  assignmentCategories?: string[];
  summary?: string;
  sourceFileName?: string;
  indexedFileName?: string;
  extractionNote?: string;
  analysisStatus?: string;
  chapters?: Array<{ title?: string; path?: string; page_start?: number | null; page_end?: number | null }>;
  questions?: Array<{ number?: string; title?: string; content_type?: string; chapter?: string }>;
  error?: string | null;
};
type QueueItem = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "indexing" | "done" | "failed";
  progress: number;
  error?: string;
};
type UsageData = {
  totals: {
    requests: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    fileSearchCalls: number;
    costMicros: number;
  };
  recent: Array<{
    id: number;
    model: string;
    source: string;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    fileSearchCalls: number;
    estimatedCostUsdMicros: number;
    createdAt: string;
  }>;
  comparisonStats?: {
    comparisons: number;
    ratedResponses: number;
    lunaPreferred: number;
    claudePreferred: number;
    deepseekPreferred: number;
    averageScore: number;
  };
  recentComparisons?: Array<{
    id: number;
    promptText: string;
    sourceStatus: string;
    createdAt: string;
    responses: Array<{ id: number; label: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsdMicros: number; durationMs: number; error?: string | null; ratings: Array<{ score: number; feedbackType: string }> }>;
  }>;
  showCosts: boolean;
  showEvidence: boolean;
  essayGradingDualEnabled: boolean;
};
type ExamSource = {
  id: number;
  url: string;
  label: string;
  examType: string;
  sourceKind: string;
  status: string;
  discoveredCount: number;
  processedCount: number;
  questionCount: number;
  lastError?: string | null;
};
type ExamProcessResult = {
  status?: string;
  processedCount?: number;
  discoveredCount?: number;
  questionCount?: number;
  message?: string;
  error?: string;
};
type DocumentStats = {
  total: number;
  ready: number;
  vectorReady: number;
  indexedBytes: number;
  citations: number;
  misses: number;
  indexVersion: string;
};
type LocalNodeStatus = {
  connected: boolean;
  node: null | {
    nodeId: string;
    name: string;
    status: "online" | "busy" | "error" | "offline";
    lastSeenAt: string;
    version: string;
    gpu: string;
    gpuMemoryGb: number | null;
    ramGb: number | null;
    models: string[];
    queuedJobs: number;
    activeJob: string;
    message: string;
  };
};
type DocumentSearchTest = {
  status: "testing" | "success" | "error";
  query: string;
  selectedFileWasSearched?: boolean;
  hits?: Array<{ fileName: string; score: number | null; text: string; pageStart: number | null; pageEnd: number | null; evidenceMatched?: boolean; title?: string; retrievalMode?: string }>;
  evidenceVerified?: boolean;
  autoResults?: Array<{ query: string; hit: boolean; hits: number; page: number | null; excerpt: string; title?: string; retrievalMode?: string; reason?: string }>;
  error?: string;
};
type DocumentSearchRun = { id: string; documentId: number; documentName: string; createdAt: string; passed: number; total: number; results: NonNullable<DocumentSearchTest["autoResults"]> };
type LearningResource = {
  id: number;
  resourceType: string;
  title: string;
  subject: string;
  creator: string;
  description: string;
  documentId: number | null;
  linkedBookId: number | null;
  sourceUrl: string;
  accessType: string;
  status: string;
  sortOrder: number;
  hasCover: number;
  segmentCount: number;
  chapterCount?: number;
  pendingChapterCount?: number;
  chapterSourceReadyCount?: number;
  sourcePageCount?: number;
  articleCount?: number;
  analyzedArticleCount?: number;
  failedArticleCount?: number;
  pendingArticleCount?: number;
  documentStatus?: string | null;
  documentError?: string | null;
  documentProcessingStage?: string | null;
  documentProcessingMessage?: string | null;
  documentFullTextIndexed?: boolean | null;
  documentVectorIndexed?: boolean | null;
  documentPageCount?: number | null;
  documentFileName?: string | null;
  documentExamCategory?: string | null;
  documentChapterCount?: number;
  documentTopicCount?: number;
  documentQuestionCount?: number;
  hasStoredChapterCatalogue?: boolean;
  storedChapterCatalogueCount?: number;
  documentExtractedChars?: number;
  documentTags?: string[];
  articlePreviews?: Array<{
    id: number;
    title: string;
    summary: string;
    reviewStatus: string;
    segmentType?: string;
    sequence: number;
    failure?: string;
    sourceUrl?: string;
    textLength?: number;
    analysisState?: "analyzed" | "captured" | "pending" | "failed";
  }>;
};
type CourseCollection = {
  id: number;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  courses: Array<LearningResource & { itemId: number; itemSortOrder: number }>;
};
type ChapterProgress = {
  state: "not_started" | "building" | "paused" | "failed" | "completed" | "needs_rebuild";
  phase?: "outline" | "questions" | "pages" | "saving" | "paused" | "failed";
  completedTopics?: number;
  totalTopics?: number;
  foundQuestions?: number;
  currentTopic?: string;
  error?: string;
  stale?: boolean;
  lastUpdatedAt?: string | null;
  pageCoverage?: { scanned: number; continuation: number; empty: number; unprocessed: number };
};
type ChapterSegment = {
  id: number;
  resourceId: number;
  segmentType: string;
  lessonLabel: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  summary: string;
  reviewStatus: string;
  sequence: number;
  completeQuestion?: boolean;
};

function isProblemSolvingResource(resource: LearningResource) {
  return /解題|題庫|題型|案例演習|申論/.test(
    `${resource.title} ${resource.description}`,
  );
}

function documentSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function uploadedDocument(item: DocumentApiRow): Uploaded {
  return {
    id: item.id,
    name: item.name,
    bookTitle: item.bookTitle ?? documentDisplayTitle(null, item.name),
    examCategory: item.examCategory ?? "law",
    subject: item.subject,
    size: `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${item.type}`,
    status: item.status,
    type: item.type,
    processingStage: item.processingStage,
    processingMessage: item.processingMessage,
    pageCount: item.pageCount,
    extractedChars: item.extractedChars,
    chapterCount: item.chapterCount,
    topicCount: item.topicCount,
    questionCount: item.questionCount,
    tags: item.tags,
    fullTextIndexed: item.fullTextIndexed,
    vectorIndexed: item.vectorIndexed,
    homepageSearchEnabled: item.homepageSearchEnabled,
    fineSearchUnitCount: item.fineSearchUnitCount,
    assignmentCount: item.assignmentCount,
    assignmentCategories: item.assignmentCategories,
    summary: item.summary,
    sourceFileName: item.sourceFileName,
    indexedFileName: item.indexedFileName,
    extractionNote: item.extractionNote,
    analysisStatus: item.analysisStatus,
    chapters: item.chapters,
    questions: item.questions,
    error: item.error,
  };
}

function documentOptionLabel(file: Uploaded) {
  const title = file.bookTitle || documentDisplayTitle(null, file.name);
  const type = file.name.split(".").pop()?.toUpperCase() || file.type?.split("/").pop()?.toUpperCase() || "文件";
  return `${title}｜${file.subject || "未分類"}｜${type}${file.pageCount ? `｜${file.pageCount}頁` : ""}`;
}

function documentSubjectMatches(file: Uploaded, subject: string) {
  const expected = documentSearchValue(subject);
  if (!expected) return true;
  const actual = documentSearchValue(file.subject);
  const title = documentSearchValue(file.bookTitle || "");
  return actual === expected || actual.includes(expected) || expected.includes(actual) || title.includes(expected);
}

function searchableDocuments(files: Uploaded[], examCategory: string, subject: string, query: string, selectedId: number | null) {
  const categoryFiles = files.filter((file) => (file.examCategory ?? "law") === examCategory);
  const subjectFiles = categoryFiles.filter((file) => documentSubjectMatches(file, subject));
  const candidates = subjectFiles.length ? subjectFiles : categoryFiles.filter((file) => file.id === selectedId);
  const needle = documentSearchValue(query);
  const filtered = needle
    ? candidates.filter((file) => documentSearchValue(`${file.bookTitle || ""} ${file.name} ${file.subject} ${file.type || ""}`).includes(needle))
    : candidates;
  if (selectedId && !filtered.some((file) => file.id === selectedId)) {
    const selected = categoryFiles.find((file) => file.id === selectedId);
    return selected ? [selected, ...filtered] : filtered;
  }
  return filtered;
}

function problemContentSections(text: string) {
  const value = text.trim();
  const match = value.match(/^【完整題目】\s*([\s\S]*?)\s*\n\s*【(爭點解析|擬答)】\s*([\s\S]+)$/u);
  if (!match) return null;
  return { question: match[1].trim(), label: match[2], analysis: match[3].trim() };
}

function chapterProgressPercent(progress?: ChapterProgress) {
  if (!progress) return 0;
  if (progress.state === "completed") return 100;
  if (progress.totalTopics && progress.completedTopics != null)
    return Math.min(99, Math.round((progress.completedTopics / progress.totalTopics) * 100));
  return progress.phase === "questions" ? 12 : progress.phase === "saving" ? 92 : 4;
}

function chapterProgressLabel(progress?: ChapterProgress) {
  if (!progress) return "尚未開始解析";
  if (progress.state === "completed") return "解析完成";
  if (progress.state === "paused") return "AI 目前較忙，將自動重試；原資料仍保留";
  if (progress.state === "failed") return "解析未完成，原資料仍保留";
  if (progress.phase === "outline") return "正在讀取原書的部分與主題目錄";
  if (progress.phase === "pages") return "正在依頁碼順序掃描原始 PDF";
  if (progress.phase === "saving") return "正在保存已完成的題型";
  return "正在逐一擷取題型與完整題目";
}
type SubtitleSegment = {
  id: number;
  startSeconds: number;
  endSeconds: number;
  title?: string;
  segmentType?: string;
  text: string;
  summary: string;
  importance: number;
  recommended: boolean;
  reviewStatus: string;
  sequence: number;
};
type ListeningItem = {
  id: number;
  questionId: number | null;
  title: string;
  year: string;
  subject: string;
  questionText: string;
  narrationScript: string;
  sourceUrl: string;
  audioStorageKey: string | null;
  audioFileName: string | null;
  status: string;
};
type ListeningSegment = {
  id: number;
  listeningId: number;
  fileName: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  sequence: number;
};
type ListeningCue = {
  id: number;
  segmentId: number | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
  sequence: number;
};
type ResourceEditorDraft = {
  id: number;
  resourceType: string;
  title: string;
  subject: string;
  creator: string;
  description: string;
  sourceUrl: string;
  status: string;
};
type MagazineIssueEditorDraft = {
  resourceId: number;
  articleId: number;
  title: string;
  summary: string;
  issue: string;
};
type ExamQuestion = {
  id: number;
  examType: string;
  year: string;
  examName: string;
  subject: string;
  questionNumber: string;
  stem: string;
  status: string;
  sourceUrl: string;
  teacherAnswer?: string;
  teacherNotes?: string;
  rubricJson?: string;
  answerSource?: string;
  answerStatus?: string;
};
type QuestionEditorDraft = {
  id: number;
  examType: string;
  year: string;
  examName: string;
  subject: string;
  questionNumber: string;
  stem: string;
  teacherAnswer: string;
  teacherNotes: string;
  rubricJson: string;
  status: string;
  sourceUrl: string;
};
type QuestionFilterOptions = { years: string[]; subjects: string[] };
type EssayQuestion = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  sourceUrl: string;
  hasTeacherAnswer?: string;
  teacherNotes?: string;
};
type LegalSource = {
  id: number;
  sourceKey: string;
  label: string;
  category: string;
  sourceUrl: string;
  status: string;
  documentCount: number;
  articleCount: number;
  importCursor: number;
  totalAvailable: number;
  lastError?: string | null;
  lastDownloadedAt?: string | null;
  categoryCounts?: Record<string, number>;
  hasArchive?: boolean;
};
type JudicialStatus = {
  configured: boolean;
  caseCount: number;
  settings: Record<string, string>;
  failedCount?: number;
  permanentFailureCount?: number;
  schedule?: {
    enabled: boolean;
    time: string;
    timezone: string;
    intervalMinutes?: number;
    window?: string;
  };
};
type ExamCountdown = { id: string; label: string; date: string; enabled: boolean };
type BattleAlert = { id: string; text: string; url: string; enabled: boolean };
const DOCUMENTS_PER_PAGE = 5;
const USAGE_PER_PAGE = 10;

async function readJson(response: Response) {
  const text = await response.text();
  try {
    const result = JSON.parse(text) as Record<string, unknown>;
    if (typeof result.error === "string" && result.error.length > 320)
      result.error = `${result.error.slice(0, 300).trim()}…`;
    return result;
  } catch {
    if (response.status === 413)
      return { error: "檔案超過單次上傳限制，請重新選擇文件" };
    return { error: `伺服器暫時無法處理這項操作（HTTP ${response.status}），請查看資料卡上的處理錯誤` };
  }
}

type BrowserLegalEntry = LegalArchiveEntry;

function unzipArchive(bytes: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function splitLegalEntries(entries: BrowserLegalEntry[], maxJsonBytes = 1_500_000) {
  const batches: BrowserLegalEntry[][] = [];
  let batch: BrowserLegalEntry[] = [];
  let bytes = 2;
  for (const entry of entries) {
    const entryBytes = new Blob([JSON.stringify(entry)]).size + 1;
    if (batch.length && bytes + entryBytes > maxJsonBytes) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(entry);
    bytes += entryBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export default function AdminPage({ workspaceMode = "management", questionBankSection = "questions" }: { workspaceMode?: "management" | "library" | "question-bank" | "members"; questionBankSection?: "questions" | "documents" | "sources" | "packages" } = {}) {
  const libraryMode = workspaceMode === "library";
  const questionBankMode = workspaceMode === "question-bank";
  const memberMode = workspaceMode === "members";
  const independentMode = libraryMode || questionBankMode || memberMode;
  useEffect(() => {
    if (workspaceMode === "management") window.location.replace("/admin/library");
  }, [workspaceMode]);
  const [activeTab, setActiveTab] = useState<
    | "documents"
    | "resources"
    | "courses"
    | "course-collections"
    | "trials"
    | "listening"
    | "magazine"
    | "legal"
    | "judicial"
    | "sources"
    | "questions"
    | "question-bank"
    | "costs"
    | "members"
    | "homepage"
    | "ai-feedback"
    | "external-index"
  >(questionBankMode ? "question-bank" : memberMode ? "members" : "documents");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberDeletionAudits, setMemberDeletionAudits] = useState<MemberDeletionAudit[]>([]);
  const [questionBankSummary, setQuestionBankSummary] = useState<QuestionBankSummary | null>(null);
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [questionBankCategory, setQuestionBankCategory] = useState("all");
  const [questionBankDomain, setQuestionBankDomain] = useState("");
  const [questionBankQuery, setQuestionBankQuery] = useState("");
  const [questionBankSubject, setQuestionBankSubject] = useState("");
  const [questionBankChapter, setQuestionBankChapter] = useState("");
  const [questionBankYear, setQuestionBankYear] = useState("");
  const [questionBankExamType, setQuestionBankExamType] = useState("");
  const [questionBankStatus, setQuestionBankStatus] = useState("");
  const [centralPdfLabel, setCentralPdfLabel] = useState("");
  const [centralPdfUrl, setCentralPdfUrl] = useState("");
  const [centralPdfExamType, setCentralPdfExamType] = useState("mcq");
  const [centralPdfAdding, setCentralPdfAdding] = useState(false);
  const [questionBankDocumentQuery, setQuestionBankDocumentQuery] = useState("");
  const [questionBankDocumentSubject, setQuestionBankDocumentSubject] = useState("");
  const [questionBankDocumentType, setQuestionBankDocumentType] = useState("");
  const [questionBankDocumentStatus, setQuestionBankDocumentStatus] = useState("");
  const [selectedQuestionBankIds, setSelectedQuestionBankIds] = useState<number[]>([]);
  const [questionPackName, setQuestionPackName] = useState("");
  const [questionPackNotice, setQuestionPackNotice] = useState("");
  const [aiFeedback, setAiFeedback] = useState<Array<{ id: number; userKey: string; feedbackType: string; messageText: string; rating: number; errorTypes: string[]; studentNote: string; model: string; originalPrompt: string; reviewStatus: string; solRequested: boolean; teacherDecision: string; teacherNote: string; correctedContent: string; createdAt: string }>>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberNotice, setMemberNotice] = useState("");
  const [memberCreating, setMemberCreating] = useState(false);
  const [externalSources, setExternalSources] = useState<ExternalIndexSource[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalSyncing, setExternalSyncing] = useState<string>("");
  const [externalDeepSyncing, setExternalDeepSyncing] = useState<number | null>(null);
  const [externalDeleting, setExternalDeleting] = useState<string>("");
  const [externalNotice, setExternalNotice] = useState("");
  const [externalQuery, setExternalQuery] = useState("");
  const [externalSourceTab, setExternalSourceTab] = useState<ExternalIndexSource["key"]>("lawdata");
  const [externalPage, setExternalPage] = useState(1);
  const [externalSelectedItemId, setExternalSelectedItemId] = useState<number | null>(null);
  const [externalTestLoading, setExternalTestLoading] = useState(false);
  const [externalTestResult, setExternalTestResult] = useState<ExternalRetrievalTest | null>(null);
  const [newMember, setNewMember] = useState({ displayName: "", email: "", password: "", className: "", role: "student" as MemberRow["role"], status: "active" as MemberRow["status"] });

  useEffect(() => {
    if (activeTab !== "ai-feedback") return;
    setFeedbackLoading(true);
    fetch("/api/chat/feedback").then((response) => response.json()).then((data) => setAiFeedback(data.feedback ?? [])).finally(() => setFeedbackLoading(false));
  }, [activeTab]);

  async function loadExternalSources() {
    setExternalLoading(true);
    try {
      const response = await fetch("/api/admin/external-index");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "讀取資源同步狀態失敗");
      setExternalSources(data.sources ?? []);
    } catch (error) {
      setExternalNotice(error instanceof Error ? error.message : "讀取失敗");
    } finally { setExternalLoading(false); }
  }

  async function readExternalIndexResponse<T extends { error?: string }>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      await response.text().catch(() => "");
      throw new Error(response.status >= 500
        ? "同步處理時間過長，系統已停止本次作業；既有索引不受影響，請稍後再試。"
        : "同步服務暫時無法回應，請重新整理後再試。");
    }
    return await response.json() as T;
  }

  useEffect(() => { if (activeTab === "external-index") void loadExternalSources(); }, [activeTab]);

  async function syncExternalSource(source: ExternalIndexSource["key"] | "lawdata" | "get" | "ibrain") {
    setExternalSourceTab(source);
    setExternalPage(1);
    setExternalSelectedItemId(null);
    setExternalSyncing(source);
    setExternalNotice("正在讀取公開索引…");
    try {
      const response = await fetch("/api/admin/external-index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
      const data = await readExternalIndexResponse<{ sources?: ExternalIndexSource[]; discovered?: number; coverage?: { books: number; authors: number; catalogues: number; descriptions: number; complete: number }; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "同步失敗");
      setExternalSources(data.sources ?? []);
      const coverage = data.coverage;
      setExternalNotice(coverage ? `已同步 ${data.discovered ?? 0} 筆索引，其中辨識 ${coverage.books} 本書；作者 ${coverage.authors}/${coverage.books}、目錄 ${coverage.catalogues}/${coverage.books}、介紹 ${coverage.descriptions}/${coverage.books}、完整度達 80% 共 ${coverage.complete} 本。未完整的資料不會被標示為完成。` : `已自動逐層探索並同步 ${data.discovered ?? 0} 筆公開索引；不必再逐頁點擊，且未抓取付費全文。`);
    } catch (error) { setExternalNotice(error instanceof Error ? error.message : "同步失敗"); }
    finally { setExternalSyncing(""); }
  }

  async function toggleExternalItem(id: number, enabled: boolean) {
    const response = await fetch("/api/admin/external-index", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, enabled }) });
    if (!response.ok) { const data = await response.json(); setExternalNotice(data.error || "更新失敗"); return; }
    setExternalSources((sources) => sources.map((source) => ({ ...source, items: source.items.map((item) => item.id === id ? { ...item, enabled, indexed: enabled } : item) })));
  }

  async function syncExternalChildren(source: ExternalIndexSource, item: ExternalIndexSource["items"][number]) {
    setExternalDeepSyncing(item.id);
    setExternalNotice(`正在讀取「${item.title}」的下一層公開資料…`);
    try {
      const response = await fetch("/api/admin/external-index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: source.key, itemId: item.id }) });
      const data = await readExternalIndexResponse<{ sources?: ExternalIndexSource[]; discovered?: number; added?: number; detailUpdated?: boolean; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "內層抓取失敗");
      setExternalSources(data.sources ?? []);
      setExternalPage(1);
      setExternalNotice(data.detailUpdated
        ? `已補齊「${item.title}」的文章詳細資料${data.added ? `，另新增 ${data.added} 筆相關公開索引` : ""}。`
        : `已檢查「${item.title}」並辨識 ${data.discovered ?? 0} 筆下一層資料；新增 ${data.added ?? 0} 筆公開索引。`);
    } catch (error) { setExternalNotice(error instanceof Error ? error.message : "內層抓取失敗"); }
    finally { setExternalDeepSyncing(null); }
  }

  async function testExternalHomepageRetrieval(item: ExternalIndexSource["items"][number]) {
    setExternalSelectedItemId(item.id);
    setExternalPage(1);
    setExternalTestLoading(true);
    setExternalTestResult(null);
    setExternalNotice(`正在用首頁相同流程測試「${item.title}」…`);
    try {
      const response = await fetch("/api/admin/external-index/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item.id }) });
      const data = await readExternalIndexResponse<ExternalRetrievalTest & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "首頁檢索測試失敗");
      setExternalTestResult(data);
      setExternalNotice(data.complete ? `首頁可完整找到本次測試的 ${data.stats.complete} 筆最末層資料。` : `已遞迴到底層：文章 ${data.hierarchy.articles}、期數 ${data.hierarchy.issues}；完整 ${data.stats.complete}、僅標題 ${data.stats.titleOnly}、找不到 ${data.stats.missing}。`);
    } catch (error) { setExternalNotice(error instanceof Error ? error.message : "首頁檢索測試失敗"); }
    finally { setExternalTestLoading(false); }
  }

  async function deleteExternalSource(source: ExternalIndexSource) {
    if (!window.confirm(`確定刪除「${source.label}」目前抓取的 ${source.items.length} 筆舊資料？\n\n刪除後首頁 Luna 將不再使用這些索引；其他網站與教材資料不受影響。`)) return;
    setExternalDeleting(source.key);
    setExternalNotice(`正在清除「${source.label}」舊資料…`);
    try {
      const response = await fetch("/api/admin/external-index", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: source.key }) });
      const data = await readExternalIndexResponse<{ sources?: ExternalIndexSource[]; deleted?: number; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "刪除失敗");
      setExternalSources(data.sources ?? []);
      setExternalPage(1);
      setExternalSelectedItemId(null);
      setExternalQuery("");
      setExternalNotice(`已刪除「${source.label}」${data.deleted ?? 0} 筆舊資料；其他來源與教材均未受影響。`);
    } catch (error) { setExternalNotice(error instanceof Error ? error.message : "刪除失敗"); }
    finally { setExternalDeleting(""); }
  }

  async function updateAiFeedback(id: number, values: { reviewStatus: string; teacherDecision?: string; teacherNote?: string; correctedContent?: string }) {
    const response = await fetch("/api/chat/feedback", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...values }) });
    if (response.ok) setAiFeedback((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [examCategory, setExamCategory] = useState<"law" | "accounting" | "medtech">("law");
  const [subject, setSubject] = useState("刑法");
  const [type, setType] = useState("教科書");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([]);
  const [deletingDocuments, setDeletingDocuments] = useState(false);
  const [documentPage, setDocumentPage] = useState(1);
  const [librarySection, setLibrarySection] = useState<"materials" | "upload">("materials");
  const [librarySearch, setLibrarySearch] = useState("");
  const [documentStats, setDocumentStats] = useState<DocumentStats>({
    total: 0,
    ready: 0,
    vectorReady: 0,
    indexedBytes: 0,
    citations: 0,
    misses: 0,
    indexVersion: "待建立",
  });
  const [localNodeStatus, setLocalNodeStatus] = useState<LocalNodeStatus>({ connected: false, node: null });
  const [documentSearchQueries, setDocumentSearchQueries] = useState<Record<number, string>>({});
  const [documentSearchTests, setDocumentSearchTests] = useState<Record<number, DocumentSearchTest>>({});
  const [documentSearchHistory, setDocumentSearchHistory] = useState<Record<number, DocumentSearchRun[]>>({});
  const [fineIndexingDocumentId, setFineIndexingDocumentId] = useState<number | null>(null);
  const [resourceDocumentQueries, setResourceDocumentQueries] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!libraryMode) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/local-node", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as LocalNodeStatus;
        if (!cancelled) setLocalNodeStatus(data);
      } catch { /* 保留離線狀態；下一輪會重試 */ }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [libraryMode]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [glmTesting, setGlmTesting] = useState(false);
  const [glmTestResult, setGlmTestResult] = useState<{ ok?: boolean; model?: string; text?: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; durationMs?: number; estimatedCostUsd?: number; error?: string } | null>(null);
  const [usagePage, setUsagePage] = useState(1);
  const [examSources, setExamSources] = useState<ExamSource[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceExamType, setSourceExamType] = useState("mcq");
  const [sourceKind, setSourceKind] = useState("exam");
  const [processingSourceId, setProcessingSourceId] = useState<number | null>(
    null,
  );
  const [batchSourceId, setBatchSourceId] = useState<number | null>(null);
  const batchStopRef = useRef(false);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [courseCollections, setCourseCollections] = useState<CourseCollection[]>([]);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [collectionStatus, setCollectionStatus] = useState("draft");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [selectedCollectionResourceId, setSelectedCollectionResourceId] = useState("");
  const [chapterProgress, setChapterProgress] = useState<Record<number, ChapterProgress>>({});
  const chapterProgressRef = useRef<Record<number, ChapterProgress>>({});
  const chapterJobsRef = useRef(new Set<number>());
  const [chapterViewer, setChapterViewer] = useState<{
    resource: LearningResource;
    rows: ChapterSegment[];
    status?: string;
    message?: string;
    incompleteCount?: number;
    sourceFailures?: Array<{ segmentId: number; title: string; error: string }>;
  } | null>(null);
  const [chapterViewerLoading, setChapterViewerLoading] = useState<number | null>(null);
  const [chapterSourceRunning, setChapterSourceRunning] = useState<number | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [resourceType, setResourceType] = useState("book");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceCreator, setResourceCreator] = useState("");
  const [resourceSubject, setResourceSubject] = useState("刑法");
  const [resourceDescription, setResourceDescription] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceDocumentId, setResourceDocumentId] = useState("");
  const [magazineUrl, setMagazineUrl] = useState(
    "https://www.angle.com.tw/magazine/m_search.asp?KindID=12",
  );
  const [magazineYear, setMagazineYear] = useState(() => new Date().getFullYear());
  const [magazineListYear, setMagazineListYear] = useState(() => new Date().getFullYear());
  const [magazineAdminQuery, setMagazineAdminQuery] = useState("");
  const [selectedMagazineAdminId, setSelectedMagazineAdminId] = useState<number | null>(null);
  const [subtitleCourse, setSubtitleCourse] = useState<LearningResource | null>(
    null,
  );
  const [subtitleSegments, setSubtitleSegments] = useState<SubtitleSegment[]>(
    [],
  );
  const [segmentPage, setSegmentPage] = useState(1);
  const [analyzingSegments, setAnalyzingSegments] = useState(false);
  const [resourceEditorDraft, setResourceEditorDraft] = useState<ResourceEditorDraft | null>(null);
  const [magazineIssueEditorDraft, setMagazineIssueEditorDraft] = useState<MagazineIssueEditorDraft | null>(null);
  const [magazineIssueTitle, setMagazineIssueTitle] = useState("");
  const [magazineIssueUrl, setMagazineIssueUrl] = useState("");
  const [syncingMagazineYear, setSyncingMagazineYear] = useState(false);
  const [creatingMagazineIssue, setCreatingMagazineIssue] = useState(false);
  const [coursePreviewTime, setCoursePreviewTime] = useState(0);
  const [coursePreviewSeekToken, setCoursePreviewSeekToken] = useState(0);
  const [coursePreviewResource, setCoursePreviewResource] = useState<LearningResource | null>(null);
  const [coursePreviewSegments, setCoursePreviewSegments] = useState<SubtitleSegment[]>([]);
  const [coursePreviewLoading, setCoursePreviewLoading] = useState(false);
  const [coursePreviewError, setCoursePreviewError] = useState("");
  const [listeningItems, setListeningItems] = useState<ListeningItem[]>([]);
  const [essayQuestions, setEssayQuestions] = useState<EssayQuestion[]>([]);
  const [listeningQuestionId, setListeningQuestionId] = useState("");
  const [listeningQuestionYear, setListeningQuestionYear] = useState("all");
  const [listeningQuestionSubject, setListeningQuestionSubject] = useState("all");
  const [listeningQuestionSearch, setListeningQuestionSearch] = useState("");
  const [previewListeningQuestionId, setPreviewListeningQuestionId] = useState<number | null>(null);
  const [listeningTitle, setListeningTitle] = useState("");
  const [listeningQuestionText, setListeningQuestionText] = useState("");
  const [listeningFile, setListeningFile] = useState<File | null>(null);
  const [listeningPackageFile, setListeningPackageFile] = useState<File | null>(
    null,
  );

  const listeningQuestionYears = useMemo(
    () => [...new Set(essayQuestions.map((question) => question.year))].sort((a, b) => b.localeCompare(a, "zh-Hant", { numeric: true })),
    [essayQuestions],
  );
  const listeningQuestionSubjects = useMemo(
    () => [...new Set(essayQuestions.filter((question) => listeningQuestionYear === "all" || question.year === listeningQuestionYear).map((question) => question.subject))].sort((a, b) => a.localeCompare(b, "zh-Hant")),
    [essayQuestions, listeningQuestionYear],
  );
  const filteredListeningQuestions = useMemo(() => {
    const keyword = listeningQuestionSearch.trim().toLocaleLowerCase("zh-Hant");
    return essayQuestions.filter((question) => {
      if (listeningQuestionYear !== "all" && question.year !== listeningQuestionYear) return false;
      if (listeningQuestionSubject !== "all" && question.subject !== listeningQuestionSubject) return false;
      if (!keyword) return true;
      return `${question.year} ${question.subject} ${question.questionNumber} ${question.stem} ${question.hasTeacherAnswer ?? ""}`.toLocaleLowerCase("zh-Hant").includes(keyword);
    });
  }, [essayQuestions, listeningQuestionSearch, listeningQuestionSubject, listeningQuestionYear]);
  const previewListeningQuestion = essayQuestions.find((question) => question.id === previewListeningQuestionId) ?? null;
  const selectedListeningQuestion = essayQuestions.find((question) => String(question.id) === listeningQuestionId) ?? null;
  const [preparedTxt, setPreparedTxt] = useState<File | null>(null);
  const [generatingListening, setGeneratingListening] = useState(false);
  const [editingListening, setEditingListening] =
    useState<ListeningItem | null>(null);
  const [listeningSegments, setListeningSegments] = useState<
    ListeningSegment[]
  >([]);
  const [listeningCues, setListeningCues] = useState<ListeningCue[]>([]);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionStatus, setQuestionStatus] = useState<"draft" | "published" | "all">("draft");
  const [questionTotal, setQuestionTotal] = useState(0);
  const [questionTotals, setQuestionTotals] = useState<Record<string, number>>(
    {},
  );
  const [questionTypeTotals, setQuestionTypeTotals] = useState<Record<string, number>>({});
  const [questionExamType, setQuestionExamType] = useState<"mcq" | "essay">("mcq");
  const [questionExamCategory, setQuestionExamCategory] = useState<"law" | "accounting" | "medtech">("law");
  const [questionYear, setQuestionYear] = useState("all");
  const [questionSubject, setQuestionSubject] = useState("all");
  const [questionFilterOptions, setQuestionFilterOptions] = useState<QuestionFilterOptions>({ years: [], subjects: [] });
  const [fetchingTeacherAnswers, setFetchingTeacherAnswers] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionEditorDraft | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [legalSources, setLegalSources] = useState<LegalSource[]>([]);
  const [syncingLegal, setSyncingLegal] = useState<string | null>(null);
  const [legalZipFiles, setLegalZipFiles] = useState<Record<string, File | null>>({});
  const [uploadingLegalZip, setUploadingLegalZip] = useState<string | null>(null);
  const [judicialStatus, setJudicialStatus] = useState<JudicialStatus | null>(
    null,
  );
  const [syncingJudicial, setSyncingJudicial] = useState(false);
  const [judicialClock, setJudicialClock] = useState(() => Date.now());
  const [judicialLaunching, setJudicialLaunching] = useState(false);
  const [focusMusicUrl, setFocusMusicUrl] = useState("");
  const [focusMusicDraft, setFocusMusicDraft] = useState("");
  const [savingFocusMusic, setSavingFocusMusic] = useState(false);
  const [examCountdowns, setExamCountdowns] = useState<ExamCountdown[]>([]);
  const [battleAlerts, setBattleAlerts] = useState<BattleAlert[]>([]);
  const [learningCenterEnabled, setLearningCenterEnabled] = useState(true);
  const [savingLearningCenter, setSavingLearningCenter] = useState(false);
  const [simulationToolsEnabled, setSimulationToolsEnabled] = useState(false);
  const [savingSimulationTools, setSavingSimulationTools] = useState(false);
  const [homeWebSearchMode, setHomeWebSearchMode] = useState<"off" | "fallback" | "always">("off");
  const [savingWebSearchMode, setSavingWebSearchMode] = useState(false);
  const [savingHomepage, setSavingHomepage] = useState(false);
  const chapterBuildRunningRef = useRef<Set<number>>(new Set());

  async function refreshChapterProgress(resourceIds: number[]) {
    const entries = await Promise.all(resourceIds.map(async (id) => {
      try {
        const response = await fetch(`/api/resources/chapters?resourceId=${id}&progress=1`, { cache: "no-store" });
        if (!response.ok) return null;
        const result = (await response.json()) as { progress?: ChapterProgress };
        return result.progress ? [id, result.progress] as const : null;
      } catch {
        return null;
      }
    }));
    setChapterProgress((current) => {
      const next = { ...current };
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      return next;
    });
  }

  async function loadDocumentCategory(category: "law" | "accounting" | "medtech" | "data-structure", replaceAll = false) {
    try {
      const response = await fetch(`/api/documents?category=${category}`, { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as { documents?: DocumentApiRow[]; stats?: DocumentStats };
      const loaded = (result.documents ?? []).map(uploadedDocument);
      setFiles((current) => replaceAll
        ? loaded
        : [...current.filter((file) => (file.examCategory ?? "law") !== category), ...loaded]);
      if (result.stats) setDocumentStats(result.stats);
      const resumable = (result.documents ?? [])
        .filter((item) => ["queued", "uploaded", "extracting", "indexing", "analyzing", "in_progress"].includes(item.processingStage ?? item.status))
        .map((item) => item.id);
      if (resumable.length) window.setTimeout(() => { void Promise.all(resumable.slice(0, 3).map((id) => processDocument(id))); }, 250);
    } catch {
      // 保留目前畫面，稍後切換類科時可再次載入。
    }
  }

  useEffect(() => {
    void (async () => {
      await loadDocumentCategory("law", true);
      await Promise.all([loadDocumentCategory("accounting"), loadDocumentCategory("medtech"), loadDocumentCategory("data-structure")]);
    })();
    fetch("/api/usage")
      .then(async (response) => {
        if (response.ok) setUsage((await response.json()) as UsageData);
      })
      .catch(() => undefined);
    fetch("/api/exam-sources")
      .then(async (response) => {
        if (response.ok)
          setExamSources(
            ((await response.json()) as { sources?: ExamSource[] }).sources ??
              [],
          );
      })
      .catch(() => undefined);
    fetch("/api/resources")
      .then(async (response) => {
        if (!response.ok) return;
        const loaded =
          ((await response.json()) as { resources?: LearningResource[] })
            .resources ?? [];
        setResources(loaded);
        void refreshChapterProgress(loaded.filter((item) => item.resourceType === "book").map((item) => item.id));
        // 修復早期版本把整段 SRT 當成一筆文字保存的舊資料。
        await Promise.all(
          loaded
            .filter((item) => item.resourceType === "course" && item.segmentCount > 0)
            .map((item) => repairResourceSubtitles(item.id, true)),
        );
      })
      .catch(() => undefined);
    fetch("/api/course-collections?all=1")
      .then(async (response) => {
        if (response.ok)
          setCourseCollections(
            ((await response.json()) as { collections?: CourseCollection[] }).collections ?? [],
          );
      })
      .catch(() => undefined);
    fetch("/api/listening")
      .then(async (response) => {
        if (response.ok) {
          const result = (await response.json()) as {
            items?: ListeningItem[];
            questions?: EssayQuestion[];
          };
          setListeningItems(result.items ?? []);
          setEssayQuestions(result.questions ?? []);
        }
      })
      .catch(() => undefined);
    fetch("/api/legal-sources")
      .then(async (response) => {
        const result = (await readJson(response)) as {
          sources?: LegalSource[];
          error?: string;
        };
        if (response.ok) setLegalSources(result.sources ?? []);
        else setNotice(result.error ?? "法規資料狀態暫時無法讀取");
      })
      .catch(() => undefined);
    fetch("/api/judicial-sync")
      .then(async (response) => {
        if (response.ok)
          setJudicialStatus((await response.json()) as JudicialStatus);
      })
      .catch(() => undefined);
    fetch("/api/site-settings")
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { focusMusicUrl?: string; examCountdowns?: ExamCountdown[]; battleAlerts?: BattleAlert[]; learningCenterEnabled?: boolean; homeWebSearchMode?: "off" | "fallback" | "always"; simulationToolsEnabled?: boolean };
        setFocusMusicUrl(result.focusMusicUrl ?? "");
        setFocusMusicDraft(result.focusMusicUrl ?? "");
        setExamCountdowns(result.examCountdowns ?? []);
        setBattleAlerts(result.battleAlerts ?? []);
        setLearningCenterEnabled(result.learningCenterEnabled !== false);
        setSimulationToolsEnabled(result.simulationToolsEnabled === true);
        setHomeWebSearchMode(result.homeWebSearchMode ?? "off");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "questions" || requested === "question-bank" || requested === "documents") setActiveTab(requested);
  }, []);

  useEffect(() => {
    if (examCategory !== "law") void loadDocumentCategory(examCategory);
  }, [examCategory]);

  useEffect(() => {
    const timer = window.setInterval(() => setJudicialClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!judicialStatus?.schedule?.enabled || syncingJudicial) return;
    const taipeiNow = new Date(judicialClock + 8 * 3600_000);
    const hour = taipeiNow.getUTCHours();
    const minute = taipeiNow.getUTCMinutes();
    const second = taipeiNow.getUTCSeconds();
    const inWindow = hour >= 0 && hour < 6;
    const atNextTick = inWindow && minute > 0 && second === 0;
    if (atNextTick) {
      setJudicialLaunching(true);
      const timer = window.setTimeout(() => setJudicialLaunching(false), 2600);
      return () => window.clearTimeout(timer);
    }
  }, [judicialClock, judicialStatus?.schedule?.enabled, syncingJudicial]);

  function judicialNextRun() {
    const taipei = new Date(judicialClock + 8 * 3600_000);
    const hour = taipei.getUTCHours();
    const minute = taipei.getUTCMinutes();
    const second = taipei.getUTCSeconds();
    let seconds = 0;
    if (hour >= 6) {
      seconds = ((24 - hour) * 60 * 60) - minute * 60 - second;
    } else if (hour === 0 && minute === 0 && second === 0) {
      seconds = 0;
    } else {
      seconds = 60 - second;
    }
    return Math.max(0, seconds);
  }

  function formatCountdown(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  async function refreshCourseCollections() {
    const response = await fetch("/api/course-collections?all=1", { cache: "no-store" });
    if (response.ok)
      setCourseCollections(
        ((await response.json()) as { collections?: CourseCollection[] }).collections ?? [],
      );
  }

  async function createCourseCollection(event: FormEvent) {
    event.preventDefault();
    if (!collectionTitle.trim()) return;
    const response = await fetch("/api/course-collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "collection",
        title: collectionTitle,
        description: collectionDescription,
        status: collectionStatus,
      }),
    });
    const result = (await readJson(response)) as { error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "課程專區建立失敗");
      return;
    }
    setCollectionTitle("");
    setCollectionDescription("");
    setCollectionStatus("draft");
    setNotice("課程專區已建立；接著可把影音課程放入專區。");
    await refreshCourseCollections();
  }

  async function updateCourseCollection(collection: CourseCollection, patch: Partial<CourseCollection>) {
    const latest = courseCollections.find((item) => item.id === collection.id) ?? collection;
    const response = await fetch("/api/course-collections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "collection", ...latest, ...patch }),
    });
    const result = (await readJson(response)) as { error?: string };
    if (!response.ok) setNotice(result.error ?? "課程專區更新失敗");
    else await refreshCourseCollections();
  }

  async function addCourseToCollection(event: FormEvent) {
    event.preventDefault();
    if (!selectedCollectionId || !selectedCollectionResourceId) {
      setNotice("請先選擇專區與影音課程。");
      return;
    }
    const response = await fetch("/api/course-collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "item", collectionId: selectedCollectionId, resourceId: selectedCollectionResourceId }),
    });
    const result = (await readJson(response)) as { error?: string };
    setNotice(response.ok ? "課程已放入專區。" : (result.error ?? "課程加入專區失敗"));
    if (response.ok) {
      setSelectedCollectionResourceId("");
      await refreshCourseCollections();
    }
  }

  async function removeCourseCollection(collection: CourseCollection) {
    if (!window.confirm(`確定移除專區「${collection.title}」？專區內課程資源不會被刪除。`)) return;
    const response = await fetch(`/api/course-collections?collectionId=${collection.id}`, { method: "DELETE" });
    setNotice(response.ok ? "課程專區已移除，原影音課程仍保留。" : "課程專區移除失敗");
    if (response.ok) await refreshCourseCollections();
  }

  async function removeCourseFromCollection(itemId: number) {
    const response = await fetch(`/api/course-collections?itemId=${itemId}`, { method: "DELETE" });
    setNotice(response.ok ? "已從專區移除，影音課程本身仍保留。" : "課程移除失敗");
    if (response.ok) await refreshCourseCollections();
  }

  useEffect(() => {
    const bookIds = resources.filter((item) => item.resourceType === "book").map((item) => item.id);
    if (!bookIds.length) return;
    const timer = window.setInterval(() => void refreshChapterProgress(bookIds), 5_000);
    return () => window.clearInterval(timer);
  }, [resources]);

  async function saveFocusMusic(event: FormEvent) {
    event.preventDefault();
    setSavingFocusMusic(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ focusMusicUrl: focusMusicDraft }) });
    const result = (await readJson(response)) as { focusMusicUrl?: string; error?: string };
    if (response.ok) { setFocusMusicUrl(result.focusMusicUrl ?? ""); setFocusMusicDraft(result.focusMusicUrl ?? ""); setNotice(result.focusMusicUrl ? "讀書音樂已設定，前台現在可以播放。" : "前台讀書音樂已清除。"); }
    else setNotice(result.error ?? "讀書音樂設定失敗");
    setSavingFocusMusic(false);
  }

  async function saveHomepageSettings() {
    setSavingHomepage(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCountdowns, battleAlerts }) });
    const result = (await readJson(response)) as { examCountdowns?: ExamCountdown[]; battleAlerts?: BattleAlert[]; error?: string };
    if (response.ok) { setExamCountdowns(result.examCountdowns ?? []); setBattleAlerts(result.battleAlerts ?? []); setNotice("考試倒數與作戰快訊已更新到前台。"); }
    else setNotice(result.error ?? "首頁訊息設定失敗");
    setSavingHomepage(false);
  }

  async function toggleLearningCenter() {
    const next = !learningCenterEnabled;
    setSavingLearningCenter(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ learningCenterEnabled: next }) });
    const result = (await readJson(response)) as { learningCenterEnabled?: boolean; error?: string };
    if (response.ok) {
      setLearningCenterEnabled(result.learningCenterEnabled !== false);
      setNotice(next ? "學習專區入口已重新開放。" : "學習專區入口已暫時隱藏；既有學習資料仍保留。");
    } else setNotice(result.error ?? "學習專區開關更新失敗");
    setSavingLearningCenter(false);
  }

  async function toggleSimulationTools() {
    const next = !simulationToolsEnabled;
    setSavingSimulationTools(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ simulationToolsEnabled: next }) });
    const result = (await readJson(response)) as { simulationToolsEnabled?: boolean; error?: string };
    if (response.ok) {
      setSimulationToolsEnabled(result.simulationToolsEnabled === true);
      window.dispatchEvent(new CustomEvent("simulation-tools-change", { detail: result.simulationToolsEnabled === true }));
      setNotice(next ? "已開啟管理測試與模擬回答。" : "已關閉所有管理測試與模擬回答。一般學習功能不受影響。");
    } else setNotice(result.error ?? "模擬回答設定更新失敗");
    setSavingSimulationTools(false);
  }

  async function saveHomeWebSearchMode(mode: "off" | "fallback" | "always") {
    setSavingWebSearchMode(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ homeWebSearchMode: mode }) });
    const result = (await readJson(response)) as { homeWebSearchMode?: "off" | "fallback" | "always"; error?: string };
    if (response.ok) {
      setHomeWebSearchMode(result.homeWebSearchMode ?? mode);
      setNotice(mode === "off" ? "首頁外網搜尋已關閉。" : mode === "always" ? "首頁每次回答都會先查外網。" : "首頁會先查站內，資料不足時才查外網。");
    } else setNotice(result.error ?? "外網搜尋設定失敗");
    setSavingWebSearchMode(false);
  }

  useEffect(() => {
    if (activeTab === "questions") loadExamQuestions(questionPage);
  }, [activeTab, questionPage, questionExamType, questionExamCategory, questionStatus, questionYear, questionSubject]);

  async function syncLegal(sourceKey: string, restart = false) {
    setSyncingLegal(sourceKey);
    try {
      let nextRestart = restart;
      let status = "importing";
      let progress = 0;
      for (let attempt = 0; attempt < 220 && status !== "ready"; attempt += 1) {
        setNotice(attempt === 0 ? "正在下載官方資料並建立法規索引…" : `正在取得官方內容並建立索引：${progress.toLocaleString()} 筆…`);
        const response = await fetch("/api/legal-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceKey, restart: nextRestart }),
        });
        const result = (await readJson(response)) as { status?: string; processed?: number; next?: number; total?: number; error?: string };
        if (!response.ok) throw new Error(result.error ?? "資料同步失敗");
        status = result.status ?? "importing";
        progress = result.next ?? progress + (result.processed ?? 0);
        nextRestart = false;
        if (status !== "ready") await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      setNotice(status === "ready" ? "官方資料、分類與內容已完成索引，現在可以進入查看。" : "資料已部分處理，請稍後再按重新同步繼續。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "資料同步失敗");
    } finally {
      const refreshed = await fetch("/api/legal-sources");
      if (refreshed.ok) setLegalSources(((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? []);
      setSyncingLegal(null);
    }
  }

  async function importLegalZipInBrowser(sourceKey: string, archive: Blob) {
    setNotice("正在瀏覽器中解壓全國法規 ZIP；這一步不受雲端處理時間限制…");
    const files = await unzipArchive(new Uint8Array(await archive.arrayBuffer()));
    const targetFiles = Object.entries(files).filter(([name]) => /(^|\/)(ChLaw|ChOrder)\.json$/i.test(name) || /(^|\/)FalV\.xml$/i.test(name) || /\.xml$/i.test(name));
    if (!targetFiles.length) throw new Error("ZIP 內找不到 ChLaw.json、ChOrder.json 或 FalV.xml");
    const entries: BrowserLegalEntry[] = [];
    for (const [name, data] of targetFiles) {
      const raw = new TextDecoder("utf-8").decode(data).replace(/^\uFEFF/, "");
      const records = /\.xml$/i.test(name) ? await parseLegalXml(raw) : collectLawObjects(JSON.parse(raw));
      const fallback: "法律" | "命令" = /(^|\/)ChOrder\.json$/i.test(name) ? "命令" : "法律";
      entries.push(...records.map((record) => ({ category: legalCategory(record, fallback), record: compactLegalRecord(record) })));
    }
    if (!entries.length) throw new Error("ZIP 已解壓，但沒有辨識到任何法律或命令");
    const batches = splitLegalEntries(entries);
    let cursor = 0;
    let categoryCounts: Record<string, number> | undefined;
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const response = await fetch("/api/legal-sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKey, entries: batch, cursor, total: entries.length, restart: index === 0, final: index === batches.length - 1 }),
      });
      const result = (await readJson(response)) as { next?: number; total?: number; categoryCounts?: Record<string, number>; error?: string };
      if (!response.ok) throw new Error(result.error ?? `第 ${index + 1} 批匯入失敗`);
      cursor = result.next ?? cursor + batch.length;
      categoryCounts = result.categoryCounts;
      setNotice(`正在建立全國法規索引：${cursor.toLocaleString()} / ${entries.length.toLocaleString()} 部`);
    }
    const breakdown = categoryCounts ? `法律 ${categoryCounts["法律"] ?? 0}、命令 ${categoryCounts["命令"] ?? 0}` : `共 ${entries.length} 部`;
    setNotice(`全國法規匯入完成：${breakdown}，條文已可供搜尋與「法條學習」使用`);
    const refreshed = await fetch("/api/legal-sources");
    if (refreshed.ok) setLegalSources(((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? []);
  }

  async function importExistingLegalZip(sourceKey: string) {
    setSyncingLegal(sourceKey);
    try {
      setNotice("正在讀取已上傳的全國法規 ZIP…");
      const response = await fetch(`/api/legal-sources/archive?sourceKey=${encodeURIComponent(sourceKey)}`);
      if (!response.ok) {
        const result = (await readJson(response)) as { error?: string };
        throw new Error(result.error ?? "已上傳的 ZIP 無法讀取");
      }
      await importLegalZipInBrowser(sourceKey, await response.blob());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "全國法規匯入失敗");
    } finally {
      setSyncingLegal(null);
    }
  }

  async function uploadLegalZip(sourceKey: string) {
    const file = legalZipFiles[sourceKey];
    if (!file) {
      setNotice("請先選擇官方法規 ZIP 檔案");
      return;
    }
    setUploadingLegalZip(sourceKey);
    const partSize = 8 * 1024 * 1024;
    let key = "";
    let uploadId = "";
    try {
      setNotice(`正在建立 R2 分段上傳：0 / ${Math.ceil(file.size / partSize)} 段…`);
      const initResponse = await fetch("/api/legal-sources/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "init",
          sourceKey,
          fileName: file.name,
          contentType: file.type || "application/zip",
          sizeBytes: file.size,
        }),
      });
      const init = (await readJson(initResponse)) as {
        key?: string;
        uploadId?: string;
        partSize?: number;
        error?: string;
      };
      if (!initResponse.ok || !init.key || !init.uploadId) {
        throw new Error(init.error ?? "無法建立 ZIP 分段上傳");
      }
      key = init.key;
      uploadId = init.uploadId;
      const actualPartSize = Number(init.partSize) || partSize;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const totalParts = Math.ceil(file.size / actualPartSize);
      for (let index = 0; index < totalParts; index += 1) {
        const partNumber = index + 1;
        const partResponse = await fetch(
          `/api/legal-sources/upload?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
          {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: file.slice(index * actualPartSize, Math.min(file.size, (index + 1) * actualPartSize)),
          },
        );
        const part = (await readJson(partResponse)) as { partNumber?: number; etag?: string; error?: string };
        if (!partResponse.ok || !part.etag) {
          throw new Error(part.error ?? `第 ${partNumber} 段上傳失敗`);
        }
        parts.push({ partNumber, etag: part.etag });
        setNotice(`正在上傳全國法規 ZIP：${partNumber} / ${totalParts} 段（每段約 8MB）…`);
      }

      const completeResponse = await fetch("/api/legal-sources/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          sourceKey,
          key,
          uploadId,
          fileName: file.name,
          contentType: file.type || "application/zip",
          sizeBytes: file.size,
          parts,
        }),
      });
      const completed = (await readJson(completeResponse)) as { error?: string };
      if (!completeResponse.ok) throw new Error(completed.error ?? "ZIP 組合失敗");
      uploadId = "";
      setNotice("ZIP 已組合完成，開始解析並分類法律／命令，接著建立索引…");
      setLegalZipFiles((current) => ({ ...current, [sourceKey]: null }));
      await fetch("/api/legal-sources").then(async (refreshed) => {
        if (refreshed.ok)
          setLegalSources(
            ((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? [],
          );
      });
      await importLegalZipInBrowser(sourceKey, file);
    } catch (error) {
      if (key && uploadId) {
        await fetch(`/api/legal-sources/upload?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => undefined);
      }
      setNotice(error instanceof Error ? error.message : "ZIP 上傳失敗");
      const refreshed = await fetch("/api/legal-sources").catch(() => null);
      if (refreshed?.ok)
        setLegalSources(
          ((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? [],
        );
    } finally {
      setUploadingLegalZip(null);
    }
  }

  async function runJudicial(action: "test" | "sync") {
    setSyncingJudicial(true);
    setNotice(
      action === "test"
        ? "正在驗證司法院 API 帳密…"
        : "正在取得異動清單並下載本批裁判書…",
    );
    const response = await fetch("/api/judicial-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Manual run uses the same batch size as the scheduled Worker. The
      // button is an immediate kick-off, not the mechanism required for
      // continued downloading.
      body: JSON.stringify({ action, limit: 120 }),
    });
    const result = (await readJson(response)) as {
      message?: string;
      imported?: number;
      pending?: number;
      removed?: number;
      error?: string;
    };
    setNotice(
      response.ok
        ? (result.message ??
            `下載 ${result.imported ?? 0} 筆、移除 ${result.removed ?? 0} 筆，尚待 ${result.pending ?? 0} 筆`)
        : (result.error ?? "司法院同步失敗"),
    );
    const refreshed = await fetch("/api/judicial-sync");
    if (refreshed.ok)
      setJudicialStatus((await refreshed.json()) as JudicialStatus);
    setSyncingJudicial(false);
  }

  async function addResource(event: FormEvent) {
    event.preventDefault();
    const selectedType =
      activeTab === "courses"
        ? "course"
        : activeTab === "trials"
          ? "trial"
        : activeTab === "resources"
          ? "book"
          : resourceType;
    const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: selectedType,
        title: resourceTitle,
        subject: resourceSubject,
        creator: resourceCreator,
        description: resourceDescription,
        sourceUrl: resourceUrl,
        documentId: resourceDocumentId || null,
        accessType: selectedType === "course" ? "full" : selectedType === "trial" ? "external" : "owned",
      }),
    });
    const result = (await readJson(response)) as {
      resource?: LearningResource;
      error?: string;
    };
    if (!response.ok || !result.resource) {
      setNotice(result.error ?? "無法建立學習資源");
      return;
    }
    setResources((current) => [result.resource!, ...current]);
    setResourceTitle("");
    setResourceCreator("");
    setResourceDescription("");
    setResourceUrl("");
    setResourceDocumentId("");
    setNotice("學習資源已建立，可繼續上傳書封或字幕。");
  }

  async function generateListening(event: FormEvent) {
    event.preventDefault();
    setGeneratingListening(true);
    setNotice("AI 正在辨識題目並撰寫可直接配音的解題聞稿…");
    const form = new FormData();
    form.set("questionId", listeningQuestionId);
    form.set("title", listeningTitle);
    form.set("questionText", listeningQuestionText);
    if (listeningFile) form.set("file", listeningFile);
    const response = await fetch("/api/listening", {
      method: "POST",
      body: form,
    });
    const result = (await readJson(response)) as {
      item?: ListeningItem;
      error?: string;
    };
    if (!response.ok || !result.item) setNotice(result.error ?? "聞稿生成失敗");
    else {
      setListeningItems((current) => [result.item!, ...current]);
      setEditingListening(result.item);
      setListeningQuestionId("");
      setListeningTitle("");
      setListeningQuestionText("");
      setListeningFile(null);
      setNotice("聞稿已生成，請先校正內容，再上傳你的配音檔。");
    }
    setGeneratingListening(false);
  }

  async function importPreparedListening() {
    if (!preparedTxt) return;
    const form = new FormData();
    form.set("preparedTxt", preparedTxt);
    form.set("title", listeningTitle);
    form.set("questionText", listeningQuestionText);
    form.set("subject", "刑法");
    setNotice("正在匯入自備 TXT 聞稿…");
    const response = await fetch("/api/listening", {
      method: "POST",
      body: form,
    });
    const result = (await readJson(response)) as {
      item?: ListeningItem;
      error?: string;
    };
    if (!response.ok || !result.item) {
      setNotice(result.error ?? "TXT 匯入失敗");
      return;
    }
    setListeningItems((current) => [result.item!, ...current]);
    setPreparedTxt(null);
    setListeningTitle("");
    setListeningQuestionText("");
    await openListeningEditor(result.item);
    setNotice("TXT 已匯入；現在可上傳一個完整音檔或多段音檔與 SRT。");
  }

  async function saveListening(item: ListeningItem, status = item.status) {
    const response = await fetch("/api/listening", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...item, status }),
    });
    const result = (await readJson(response)) as {
      item?: ListeningItem;
      error?: string;
    };
    if (!response.ok || !result.item) {
      setNotice(result.error ?? "儲存失敗");
      return;
    }
    setListeningItems((current) =>
      current.map((row) => (row.id === item.id ? result.item! : row)),
    );
    setEditingListening(result.item);
    setNotice(
      status === "published" ? "已發布為前台聽解題內容。" : "聞稿已儲存。",
    );
  }

  async function uploadListeningAudio(item: ListeningItem, file?: File) {
    if (!file) return;
    const form = new FormData();
    form.set("id", String(item.id));
    form.set("audio", file);
    setNotice("正在上傳配音檔…");
    const response = await fetch("/api/listening", {
      method: "PUT",
      body: form,
    });
    const result = (await readJson(response)) as {
      item?: ListeningItem;
      error?: string;
    };
    if (!response.ok || !result.item) {
      setNotice(result.error ?? "配音上傳失敗");
      return;
    }
    setListeningItems((current) =>
      current.map((row) => (row.id === item.id ? result.item! : row)),
    );
    setEditingListening(result.item);
    setNotice("配音已上傳，可以試聽並發布。");
  }

  async function openListeningEditor(item: ListeningItem) {
    setEditingListening(item);
    const response = await fetch(
      `/api/listening/segments?listeningId=${item.id}`,
    );
    if (response.ok) {
      const result = (await response.json()) as {
        segments?: ListeningSegment[];
        cues?: ListeningCue[];
      };
      setListeningSegments(result.segments ?? []);
      setListeningCues(result.cues ?? []);
    }
  }

  function audioDuration(file: File) {
    return new Promise<number>((resolve) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      audio.src = url;
    });
  }

  async function uploadListeningSegments(files?: FileList | null) {
    if (!editingListening || !files?.length) return;
    setNotice(`正在依序上傳 ${files.length} 段配音…`);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("action", "audio");
      form.set("listeningId", String(editingListening.id));
      form.set("file", file);
      form.set("durationSeconds", String(await audioDuration(file)));
      const response = await fetch("/api/listening/segments", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const result = await readJson(response);
        setNotice(String(result.error || `${file.name} 上傳失敗`));
        return;
      }
    }
    await openListeningEditor(editingListening);
    setNotice("分段配音已依順序上傳，系統已建立連續時間軸。");
  }

  async function replaceListeningSegment(
    segment: ListeningSegment,
    file?: File,
  ) {
    if (!editingListening || !file) return;
    const form = new FormData();
    form.set("action", "audio");
    form.set("listeningId", String(editingListening.id));
    form.set("replaceId", String(segment.id));
    form.set("file", file);
    form.set("durationSeconds", String(await audioDuration(file)));
    setNotice(`正在取代第 ${segment.sequence + 1} 段…`);
    const response = await fetch("/api/listening/segments", {
      method: "POST",
      body: form,
    });
    const result = await readJson(response);
    if (!response.ok) {
      setNotice(String(result.error || "音檔取代失敗"));
      return;
    }
    await openListeningEditor(editingListening);
    setNotice(`第 ${segment.sequence + 1} 段已取代，後續時間軸已自動調整。`);
  }

  async function saveListeningCue(cue: ListeningCue) {
    const response = await fetch("/api/listening/segments", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cueId: cue.id,
        text: cue.text,
        startSeconds: cue.startSeconds,
        endSeconds: cue.endSeconds,
      }),
    });
    if (!response.ok) {
      setNotice("字幕儲存失敗");
      return;
    }
    setNotice("此段字幕文字已校正。");
  }

  async function uploadListeningZip(
    file?: File,
    targetItem: ListeningItem | null = editingListening,
  ) {
    if (!targetItem || !file) return;
    setNotice("正在解析 ZIP 並依檔名排列音檔…");
    try {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const allAudio = Object.keys(entries)
        .filter((name) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(name))
        .sort((a, b) => a.localeCompare(b, "zh-TW", { numeric: true }));
      const numbered = allAudio.filter((name) =>
        /^\d+\.(mp3|m4a|wav|aac|ogg)$/i.test(name.split("/").pop() || ""),
      );
      const names = numbered.length ? numbered : allAudio;
      if (!names.length) {
        setNotice("ZIP 內找不到支援的音檔");
        return;
      }
      for (const name of names) {
        const extension = name.split(".").pop()?.toLowerCase();
        const type =
          extension === "m4a"
            ? "audio/mp4"
            : extension === "wav"
              ? "audio/wav"
              : extension === "ogg"
                ? "audio/ogg"
                : extension === "aac"
                  ? "audio/aac"
                  : "audio/mpeg";
        const audioFile = new File(
          [entries[name]],
          name.split("/").pop() || name,
          { type },
        );
        const form = new FormData();
        form.set("action", "audio");
        form.set("listeningId", String(targetItem.id));
        form.set("file", audioFile);
        form.set("durationSeconds", String(await audioDuration(audioFile)));
        const response = await fetch("/api/listening/segments", {
          method: "POST",
         …54471 tokens truncated…Name="field listening-question">
                直接貼上題目
                <textarea
                  value={listeningQuestionText}
                  onChange={(e) => setListeningQuestionText(e.target.value)}
                  rows={5}
                  placeholder="貼上申論題題幹；若已選真題可留空"
                />
              </label>
              <label className="listening-upload">
                上傳題目圖片或 PDF
                <input
                  type="file"
                  accept="image/*,.pdf"
                  hidden
                  onChange={(e) =>
                    setListeningFile(e.target.files?.[0] ?? null)
                  }
                />
                <strong>{listeningFile?.name || "選擇題目檔"}</strong>
                <span>圖片／PDF，12MB 以下</span>
              </label>
              <button
                className="primary-btn"
                disabled={
                  generatingListening ||
                  (!listeningQuestionId &&
                    !listeningQuestionText.trim() &&
                    !listeningFile)
                }
              >
                {generatingListening ? "AI 正在生成聞稿…" : "AI 生成解題聞稿"}
              </button>
            </form>
            {previewListeningQuestion && (
              <div className="listening-question-modal" role="dialog" aria-modal="true" aria-label="查看二試題目與老師擬答" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewListeningQuestionId(null); }}>
                <article>
                  <header>
                    <div>
                      <span>{previewListeningQuestion.year} · {previewListeningQuestion.subject}</span>
                      <h3>第 {previewListeningQuestion.questionNumber} 題</h3>
                    </div>
                    <button type="button" aria-label="關閉" onClick={() => setPreviewListeningQuestionId(null)}>×</button>
                  </header>
                  <section>
                    <h4>題目全文</h4>
                    <p>{previewListeningQuestion.stem}</p>
                  </section>
                  <section className="teacher-answer-preview">
                    <h4>老師擬答</h4>
                    {previewListeningQuestion.hasTeacherAnswer?.trim() ? <p>{previewListeningQuestion.hasTeacherAnswer}</p> : <p className="missing">這題目前尚未核對老師擬答。</p>}
                  </section>
                  <footer>
                    <button type="button" onClick={() => setPreviewListeningQuestionId(null)}>返回題庫</button>
                    <button type="button" className="primary-btn" disabled={!previewListeningQuestion.hasTeacherAnswer?.trim()} onClick={() => { setListeningQuestionId(String(previewListeningQuestion.id)); setPreviewListeningQuestionId(null); }}>
                      {String(previewListeningQuestion.id) === listeningQuestionId ? "已選用這一題" : "選用這一題"}
                    </button>
                  </footer>
                </article>
              </div>
            )}
            <div className="listening-package-card">
              <div>
                <strong>直接匯入聽解題 ZIP</strong>
                <span>
                  ZIP 內放 TXT
                  聞稿、001.mp3～、SRT；系統會自動建立為一道題並分段對齊。
                </span>
              </div>
              <label>
                {listeningPackageFile?.name || "選擇 ZIP 套件"}
                <input
                  type="file"
                  accept=".zip,application/zip"
                  hidden
                  onChange={(e) =>
                    setListeningPackageFile(e.target.files?.[0] ?? null)
                  }
                />
              </label>
              <button
                type="button"
                disabled={!listeningPackageFile}
                onClick={importListeningPackage}
              >
                匯入 ZIP
              </button>
            </div>
            {notice && <div className="notice">{notice}</div>}
            <div className="listening-list">
              {listeningItems.map((item) => (
                <article
                  key={item.id}
                  className={item.status === "published" ? "published" : ""}
                >
                  <div className="listening-badge">聽</div>
                  <div>
                    <span>
                      {item.year || "自訂題目"} · {item.subject}
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.narrationScript.slice(0, 90)}…</p>
                    <small>
                      {item.status === "published" ? "前台發布" : "草稿"}
                    </small>
                  </div>
                  <div className="listening-actions">
                    <button onClick={() => openListeningEditor(item)}>
                      校稿／分段配音
                    </button>
                    <button
                      className="danger"
                      onClick={() => removeListening(item)}
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {activeTab === "magazine" && (
          <section className="panel resource-manager">
            <div className="cost-heading">
              <div>
                <h2>月旦法學教室</h2>
                <p className="panel-sub">
                  選擇年度後，自動抓取該年度全部期數、每期四篇試讀文章標題與 PDF，再整理摘要與核心爭點；資料先進草稿，確認後再供前台推薦。
                </p>
              </div>
              <span className="source-count">
                {
                  resources.filter((item) => item.resourceType === "magazine")
                    .length
                }{" "}
                期
              </span>
            </div>
            <div className="magazine-import">
              <label className="field">
                月旦法學教室歷期網址
                <input
                  type="url"
                  value={magazineUrl}
                  onChange={(e) => setMagazineUrl(e.target.value)}
                />
              </label>
              <label className="field magazine-year-field">
                年度
                <select value={magazineYear} onChange={(event) => setMagazineYear(Number(event.target.value))}>
                  {Array.from({ length: 12 }, (_, index) => new Date().getFullYear() - index).map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void analyzeMagazine()}
                disabled={syncingMagazineYear}
              >
                {syncingMagazineYear ? `正在抓取 ${magazineYear} 年…` : "自動抓取該年度"}
              </button>
            </div>
            <form className="magazine-add-issue" onSubmit={createMagazineIssue}>
              <div>
                <strong>新增指定期數</strong>
                <span>輸入本期名稱與期刊頁網址，建立後會自動抓取試讀文章與分析。</span>
              </div>
              <input value={magazineIssueTitle} onChange={(event) => setMagazineIssueTitle(event.target.value)} placeholder="例如：月旦法學教室第287期" aria-label="新增期數名稱" />
              <input type="url" value={magazineIssueUrl} onChange={(event) => setMagazineIssueUrl(event.target.value)} placeholder="本期 m_single.asp 網址" aria-label="新增期數網址" />
              <button type="submit" className="secondary-btn" disabled={creatingMagazineIssue}>{creatingMagazineIssue ? "建立與分析中…" : "新增期數並分析"}</button>
            </form>
            {notice && <div className="notice">{notice}</div>}
            {(() => {
              const magazines = resources.filter((item) => item.resourceType === "magazine");
              const years = Array.from(new Set(magazines.map((item) => Number(item.description.match(/(20\d{2})[年/]/)?.[1])).filter(Boolean).concat([new Date().getFullYear()]))).sort((a, b) => b - a);
              const query = magazineAdminQuery.trim().toLocaleLowerCase("zh-Hant");
              const visibleIssues = magazines
                .filter((item) => Number(item.description.match(/(20\d{2})[年/]/)?.[1]) === magazineListYear)
                .filter((item) => !query || [item.title, item.creator, item.description, ...(item.articlePreviews ?? []).map((article) => article.title)].join(" ").toLocaleLowerCase("zh-Hant").includes(query));
              const selectedResource = visibleIssues.find((item) => item.id === selectedMagazineAdminId) ?? visibleIssues[0] ?? null;
              return <div className="magazine-admin-browser">
                <aside className="magazine-admin-index">
                  <label className="magazine-admin-search">
                    <span>搜尋期數、文章或老師</span>
                    <input value={magazineAdminQuery} onChange={(event) => setMagazineAdminQuery(event.target.value)} placeholder="輸入關鍵字、老師名稱…" />
                  </label>
                  <nav className="magazine-admin-years" aria-label="後台法學教室年度">
                    {years.map((year) => <button type="button" key={year} className={magazineListYear === year ? "active" : ""} onClick={() => { setMagazineListYear(year); setSelectedMagazineAdminId(null); }}>{year} 年<span>{magazines.filter((item) => Number(item.description.match(/(20\d{2})[年/]/)?.[1]) === year).length}</span></button>)}
                  </nav>
                  <div className="magazine-admin-issues">
                    {visibleIssues.map((resource) => <button type="button" key={resource.id} className={selectedResource?.id === resource.id ? "active" : ""} onClick={() => setSelectedMagazineAdminId(resource.id)}><strong>{resource.title.match(/第\s*(\d+)\s*期/)?.[0] ?? resource.title}</strong><small>{resource.title}</small><span>{resource.articleCount ?? resource.segmentCount} 篇試讀 · {resource.status === "draft" ? "待確認" : "前台顯示"}</span></button>)}
                    {!visibleIssues.length && <p>這個年度找不到符合的期數或文章。</p>}
                  </div>
                </aside>
                <div className="magazine-admin-detail">
                  {selectedResource ? [selectedResource].map((resource) => (
                  <article className="resource-card magazine-resource-card" key={resource.id}>
                    <div className="resource-cover">
                      <span>刊</span>
                    </div>
                    <div className="resource-info">
                      <span className="magazine-status-label">
                        {resource.status === "draft" ? "待確認" : "前台顯示"}
                      </span>
                      <h3 className="magazine-resource-title">{resource.title}</h3>
                      <p className="magazine-resource-creator">{resource.creator}</p>
                      <small className="magazine-resource-meta">
                        {resource.description || "尚未取得出刊資料"}
                      </small>
                      <div className="magazine-analysis-summary" aria-label="法學教室分析統計">
                        <div><strong>{resource.articleCount ?? resource.segmentCount}</strong><span>已抓取</span></div>
                        <div className="is-ready"><strong>{resource.analyzedArticleCount ?? 0}</strong><span>已完成分析</span></div>
                        <div className="is-pending"><strong>{resource.pendingArticleCount ?? resource.segmentCount}</strong><span>待處理</span></div>
                      </div>
                      {resource.articlePreviews?.length ? (
                        <div className="admin-article-previews">
                          <b>試讀文章處理狀態</b>
                          {resource.articlePreviews.map((article) => {
                            const analysis = parseMagazineAnalysis(article.summary);
                            const state = article.analysisState ?? (article.reviewStatus === "ai_reviewed" ? "analyzed" : "pending");
                            const stateLabel = state === "analyzed"
                              ? article.textLength
                                ? `AI 已完成分析 · ${article.textLength.toLocaleString()} 字，可供 AI 搜尋`
                                : "主要爭點已人工確認 · 正文尚未完成擷取"
                              : state === "captured"
                                ? `已抓到原始內容 · ${article.textLength?.toLocaleString() ?? 0} 字，尚未完成 AI 重點整理`
                                : state === "failed"
                                  ? `分析失敗 · ${article.failure || "請再次執行分析"}`
                                  : "已抓到試讀 PDF 入口，尚未完成 AI 分析";
                            return (
                              <div key={article.id} className={`admin-article-row state-${state}`}>
                                <span>{article.sequence}. {article.title}</span>
                                <small>{stateLabel}</small>
                                {article.sourceUrl ? <a href={article.sourceUrl} target="_blank" rel="noreferrer">查看試讀 PDF</a> : null}
                                {state === "analyzed" ? <><div className="admin-article-issue admin-article-summary"><b>摘要</b><span>{analysis.summary || "舊資料尚未拆出摘要，重新分析後會補上。"}</span></div><div className="admin-article-issue"><b>核心爭點</b><span>{analysis.issue || "尚未擷取到爭點，請人工補上。"}</span></div></> : null}
                                <button type="button" className="magazine-issue-edit" onClick={() => editMagazineIssue(resource.id, article)}>編輯核心爭點</button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="magazine-empty-analysis">
                          尚未建立試讀文章清單。請按「自動分析最新一期」重新抓取；抓取完成後，這裡會逐篇顯示 AI 分析狀態。
                        </div>
                      )}
                    </div>
                    <div className="resource-actions">
                      <a
                        href={resource.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        檢視來源
                      </a>
                      <div className="resource-edit-actions">
                        {resource.resourceType === "magazine" && resource.status === "draft" && resource.articlePreviews?.some((article) => article.reviewStatus === "ai_reviewed") ? <button type="button" className="primary-btn" onClick={() => publishMagazine(resource)}>發布到首頁</button> : null}
                        <button
                          type="button"
                          onClick={() => editResource(resource)}
                        >
                          編輯
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => removeResource(resource)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  </article>
                  )) : <div className="magazine-admin-empty">請先從左側選擇年度與期數。</div>}
                </div>
              </div>;
            })()}
          </section>
        )}
        {activeTab === "sources" && (
          <section className="panel exam-source-panel">
            <div className="cost-heading">
              <div>
                <h2>真題、法條與參考來源網址</h2>
                <p className="panel-sub">
                  真題拆成題目；法條建立法規名稱與條號索引；一般網站切成可引用段落。所有來源都要人工確認後才發布。
                </p>
              </div>
              <span className="source-count">{examSources.length} 個來源</span>
            </div>
            <form
              className="source-form source-form-wide"
              onSubmit={addExamSource}
            >
              <label className="field">
                來源類型
                <select
                  value={sourceKind}
                  onChange={(event) => setSourceKind(event.target.value)}
                >
                  <option value="exam">歷屆真題</option>
                  <option value="regulation">法條資料庫</option>
                  <option value="reference">參考網站</option>
                </select>
              </label>
              <label className="field">
                來源名稱
                <input
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  placeholder={
                    sourceKind === "regulation"
                      ? "例如：全國法規資料庫"
                      : "來源名稱"
                  }
                />
              </label>
              {sourceKind === "exam" && (
                <label className="field">
                  題型
                  <select
                    value={sourceExamType}
                    onChange={(event) => setSourceExamType(event.target.value)}
                  >
                    <option value="mcq">一試選擇題</option>
                    <option value="essay">二試申論題</option>
                  </select>
                </label>
              )}
              <label className="field source-url">
                網址
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <button
                className="primary-btn"
                type="submit"
                disabled={!sourceLabel.trim() || !sourceUrl.trim()}
              >
                加入資料處理清單
              </button>
            </form>
            {examSources.length ? (
              <div className="source-list">
                {examSources.map((source) => {
                  const statusLabel =
                    source.status === "waiting"
                      ? "等待處理"
                      : source.status === "discovering"
                        ? "搜尋 PDF 中"
                        : source.status === "extracting"
                          ? "AI 拆題中"
                          : source.status === "review"
                            ? "待人工確認"
                            : source.status === "failed"
                              ? "處理失敗"
                              : source.status;
                  return (
                    <div key={source.id}>
                      <span>
                        {source.sourceKind === "regulation"
                          ? "法條"
                          : source.sourceKind === "reference"
                            ? "參考"
                            : source.examType === "mcq"
                              ? "一試"
                              : "二試"}
                      </span>
                      <div>
                        <strong>{source.label}</strong>
                        <small>{source.url}</small>
                        {source.sourceKind === "exam" && (
                          <small className="source-progress">
                            已處理 {source.processedCount ?? 0} /{" "}
                            {source.discoveredCount ?? 0} 份 PDF · 拆出{" "}
                            {source.questionCount ?? 0} 題
                            {source.lastError ? ` · ${source.lastError}` : ""}
                          </small>
                        )}
                      </div>
                      <em>{statusLabel}</em>
                      {source.sourceKind === "exam" && (
                        <div className="source-actions">
                          {batchSourceId === source.id ? (
                            <button
                              className="source-stop"
                              type="button"
                              onClick={() => {
                                batchStopRef.current = true;
                                setNotice(
                                  "收到停止指令；完成目前這份 PDF 後停止。",
                                );
                              }}
                            >
                              停止批次
                            </button>
                          ) : (
                            <>
                              {source.examType === "essay" ? <button
                                className="source-process"
                                type="button"
                                disabled={processingSourceId !== null}
                                onClick={() => rescanExamSource(source.id)}
                              >
                                {processingSourceId === source.id ? "掃描中…" : "重新掃描補齊"}
                              </button> : null}
                              <button
                                className="source-process"
                                type="button"
                                disabled={
                                  processingSourceId !== null ||
                                  source.status === "review"
                                }
                                onClick={() => processExamSource(source.id)}
                              >
                                {processingSourceId === source.id
                                  ? "處理中…"
                                  : source.status === "failed"
                                    ? "重試"
                                    : source.status === "review"
                                      ? "已完成"
                                      : source.discoveredCount
                                        ? "處理下一份"
                                        : "立即處理"}
                              </button>
                              <button
                                className="source-batch"
                                type="button"
                                disabled={
                                  processingSourceId !== null ||
                                  source.status === "review"
                                }
                                onClick={() => processAllExamSource(source.id)}
                              >
                                批次全部
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className="source-delete"
                        onClick={() => removeExamSource(source)}
                      >
                        刪除
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="usage-empty">尚未加入來源網址。</p>
            )}
          </section>
        )}
        {activeTab === "questions" && (
          <section className="panel question-review">
            <div className="cost-heading">
              <div>
                <h2>真題拆解審核</h2>
                <p className="panel-sub">
                  拆解後預設為草稿；發布後才會出現在前台的一試選擇題與二試申論題。
                </p>
              </div>
              <span className="source-count">
                草稿 {questionTotals.draft ?? questionTotal} · 已發布{" "}
                {questionTotals.published ?? 0}
              </span>
            </div>
            <div className="question-category-tabs" aria-label="真題題型分類">
              <button type="button" className={questionExamType === "mcq" ? "active" : ""} onClick={() => { setQuestionPage(1); setQuestionExamType("mcq"); setQuestionYear("all"); setQuestionSubject("all"); }}><strong>一試選擇題</strong><span>{questionTypeTotals.mcq ?? 0} 題</span><small>獨立題庫／答案與選項</small></button>
              <button type="button" className={questionExamType === "essay" ? "active" : ""} onClick={() => { setQuestionPage(1); setQuestionExamType("essay"); setQuestionYear("all"); setQuestionSubject("all"); }}><strong>二試申論題</strong><span>{questionTypeTotals.essay ?? 0} 題</span><small>獨立題庫／老師擬答與評分點</small></button>
            </div>
            <div className="question-taxonomy" aria-label="考科年度篩選">
              <label><span>類科</span><select value={questionExamCategory} onChange={(event) => { const category = event.target.value as "law" | "accounting" | "medtech"; setQuestionPage(1); setQuestionExamCategory(category); setQuestionYear("all"); setQuestionSubject("all"); }}><option value="law">司律</option><option value="accounting">會計</option><option value="medtech">醫檢師</option></select></label>
              <div><span>目前分類</span><strong>{questionExamCategory === "medtech" ? "醫檢師" : questionExamCategory === "accounting" ? "會計" : "司律"}／{questionExamType === "mcq" ? "選擇題" : "申論題"}</strong></div>
              <label><span>顯示狀態</span><select value={questionStatus} onChange={(event) => { setQuestionPage(1); setQuestionStatus(event.target.value as "draft" | "published" | "all"); }}><option value="draft">待審核草稿</option><option value="published">已發布</option><option value="all">全部題目</option></select></label>
              <label><span>考科</span><select value={questionSubject} onChange={(event) => { setQuestionPage(1); setQuestionSubject(event.target.value); }}><option value="all">全部考科</option>{questionFilterOptions.subjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label>
              <label><span>年度</span><select value={questionYear} onChange={(event) => { setQuestionPage(1); setQuestionYear(event.target.value); }}><option value="all">全部年度</option>{questionFilterOptions.years.map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
              {questionExamType === "essay" && <button type="button" className="answer-fetch-button" disabled={fetchingTeacherAnswers || !examQuestions.length} onClick={() => void fetchTeacherAnswers(examQuestions.map((item) => item.id))}>{fetchingTeacherAnswers ? "擬答抓取中…" : "補抓本頁老師擬答"}</button>}
            </div>
            <div className="question-review-actions">
              <button
                type="button"
                disabled={!examQuestions.length}
                onClick={() =>
                  publishQuestions(examQuestions.map((item) => item.id))
                }
              >
                發布本頁 10 題
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={!questionTotal}
                onClick={() =>
                  window.confirm(`確定發布全部 ${questionTotal} 題草稿？`) &&
                  publishQuestions(undefined, true)
                }
              >
                批次發布全部草稿
              </button>
            </div>
            {notice && <div className="notice">{notice}</div>}
            <div className="question-review-list">
              {examQuestions.map((question) => (
                <article key={question.id}>
                  <header>
                    <span>
                      {question.examType === "mcq"
                        ? "一試選擇題"
                        : "二試申論題"}
                    </span>
                    <b>
                      {question.year}年｜{question.examName || "類科待辨識"}｜{question.subject}｜第{" "}
                      {question.questionNumber} 題
                    </b>
                  </header>
                  <p>{question.stem}</p>
                  <footer>
                    {question.sourceUrl && (
                      <a
                        href={question.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        檢視來源
                      </a>
                    )}
                    {question.examType === "essay" && <span className={`teacher-answer-badge ${question.teacherAnswer?.trim() ? "ready" : "missing"}`}>{question.teacherAnswer?.trim() ? "老師擬答已抓取" : "尚無老師擬答"}</span>}
                    <button type="button" className="question-edit-button" onClick={() => openQuestionEditor(question)}>編輯題目／擬答</button>
                    <button disabled={question.examType === "essay" && !question.teacherAnswer?.trim()} title={question.examType === "essay" && !question.teacherAnswer?.trim() ? "先補抓並核對老師擬答" : undefined} onClick={() => publishQuestions([question.id])}>
                      發布前台
                    </button>
                  </footer>
                  {question.examType === "essay" && question.teacherAnswer?.trim() && <details className="teacher-answer-preview"><summary>查看老師參考擬答與評分依據</summary><p>{question.teacherAnswer}</p>{question.teacherNotes && <small>試題評析／考點命中：{question.teacherNotes}</small>}</details>}
                </article>
              ))}
            </div>
            {questionTotal > 10 && (
              <nav className="document-pagination">
                <button
                  disabled={questionPage === 1}
                  onClick={() => setQuestionPage((page) => page - 1)}
                >
                  上一頁
                </button>
                <span>
                  第 {questionPage} / {Math.ceil(questionTotal / 10)} 頁
                </span>
                <button
                  disabled={questionPage >= Math.ceil(questionTotal / 10)}
                  onClick={() => setQuestionPage((page) => page + 1)}
                >
                  下一頁
                </button>
              </nav>
            )}
          </section>
        )}
      </div>
      {editingQuestion && (
        <div className="question-editor-backdrop" role="presentation" onClick={() => setEditingQuestion(null)}>
          <section className="question-editor" role="dialog" aria-modal="true" aria-labelledby="question-editor-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>{editingQuestion.examType === "essay" ? "二試申論題編輯" : "一試選擇題編輯"}</span><h2 id="question-editor-title">{editingQuestion.year}年｜{editingQuestion.examName}｜{editingQuestion.subject}｜第 {editingQuestion.questionNumber} 題</h2></div>
              <button type="button" onClick={() => setEditingQuestion(null)} aria-label="關閉編輯">×</button>
            </header>
            <div className="question-editor-grid">
              <label>年度<input value={editingQuestion.year} onChange={(event) => setEditingQuestion({ ...editingQuestion, year: event.target.value })} /></label>
              <label>考試名稱／類科<input value={editingQuestion.examName} onChange={(event) => setEditingQuestion({ ...editingQuestion, examName: event.target.value })} placeholder="例如：律師、司法官第二試" /></label>
              <label>考科<input value={editingQuestion.subject} onChange={(event) => setEditingQuestion({ ...editingQuestion, subject: event.target.value })} /></label>
              <label>題號<input value={editingQuestion.questionNumber} onChange={(event) => setEditingQuestion({ ...editingQuestion, questionNumber: event.target.value })} /></label>
            </div>
            <label className="question-editor-field">完整題目<textarea rows={9} value={editingQuestion.stem} onChange={(event) => setEditingQuestion({ ...editingQuestion, stem: event.target.value })} /></label>
            {editingQuestion.examType === "essay" && <>
              <label className="question-editor-field">老師參考擬答<textarea rows={14} value={editingQuestion.teacherAnswer} onChange={(event) => setEditingQuestion({ ...editingQuestion, teacherAnswer: event.target.value })} placeholder="補抓後會顯示在這裡，也可以人工修正。" /></label>
              <label className="question-editor-field">試題評析／考點命中<textarea rows={7} value={editingQuestion.teacherNotes} onChange={(event) => setEditingQuestion({ ...editingQuestion, teacherNotes: event.target.value })} /></label>
              <label className="question-editor-field">評分依據 JSON<textarea rows={7} value={editingQuestion.rubricJson} onChange={(event) => setEditingQuestion({ ...editingQuestion, rubricJson: event.target.value })} placeholder='例如：[{"criterion":"爭點","points":"10","must_include":"..."}]' /></label>
              <p className="question-editor-hint">補抓本頁後，先在這個視窗檢查老師擬答與評分依據，再儲存；儲存內容會提供給 AI 申論批改。</p>
            </>}
            <footer><button type="button" onClick={() => setEditingQuestion(null)}>取消</button><button type="button" className="primary-btn" onClick={() => void saveQuestion()} disabled={savingQuestion}>{savingQuestion ? "儲存中…" : "儲存編輯內容"}</button></footer>
          </section>
        </div>
      )}
      {resourceEditorDraft && (
        <div className="resource-editor-backdrop" role="presentation" onClick={() => setResourceEditorDraft(null)}>
          <section className="resource-editor" role="dialog" aria-modal="true" aria-labelledby="resource-editor-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>{resourceEditorDraft.resourceType === "magazine" ? "法學教室期數" : resourceEditorDraft.resourceType === "course" ? "影音課程" : "書籍"}資料編輯</span><h2 id="resource-editor-title">編輯內容</h2></div>
              <button type="button" onClick={() => setResourceEditorDraft(null)} aria-label="關閉編輯">×</button>
            </header>
            <div className="resource-editor-grid">
              <label>名稱<input value={resourceEditorDraft.title} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, title: event.target.value })} /></label>
              <label>作者／老師／出版單位<input value={resourceEditorDraft.creator} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, creator: event.target.value })} /></label>
              <label>科目<input value={resourceEditorDraft.subject} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, subject: event.target.value })} /></label>
              <label>發布狀態<select value={resourceEditorDraft.status} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, status: event.target.value })}><option value="draft">草稿／待確認</option><option value="active">發布到學生端</option><option value="archived">封存</option></select></label>
            </div>
            <label className="resource-editor-field">來源網址<input type="url" value={resourceEditorDraft.sourceUrl} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, sourceUrl: event.target.value })} /></label>
            <label className="resource-editor-field">說明<textarea rows={5} value={resourceEditorDraft.description} onChange={(event) => setResourceEditorDraft({ ...resourceEditorDraft, description: event.target.value })} /></label>
            <p className="resource-editor-hint">影音課程的來源網址請填可直接播放的 .m3u8 或 .mp4；ibrain 課程頁網址不能直接嵌入。影片、SRT、摘要與法教文章請從各自的預覽／校正功能處理。</p>
            <footer><button type="button" onClick={() => setResourceEditorDraft(null)}>取消</button><button type="button" className="primary-btn" onClick={() => void saveResourceEditor()}>儲存編輯內容</button></footer>
          </section>
        </div>
      )}
      {magazineIssueEditorDraft && (
        <div className="resource-editor-backdrop" role="presentation" onClick={() => setMagazineIssueEditorDraft(null)}>
          <section className="resource-editor magazine-issue-editor" role="dialog" aria-modal="true" aria-labelledby="magazine-issue-editor-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>月旦法學教室試讀文章</span><h2 id="magazine-issue-editor-title">編輯摘要與核心爭點</h2></div>
              <button type="button" onClick={() => setMagazineIssueEditorDraft(null)} aria-label="關閉編輯">×</button>
            </header>
            <label className="resource-editor-field">文章標題<input value={magazineIssueEditorDraft.title} readOnly /></label>
            <label className="resource-editor-field">摘要<textarea rows={8} value={magazineIssueEditorDraft.summary} onChange={(event) => setMagazineIssueEditorDraft({ ...magazineIssueEditorDraft, summary: event.target.value })} /></label>
            <label className="resource-editor-field">核心爭點<textarea rows={6} value={magazineIssueEditorDraft.issue} onChange={(event) => setMagazineIssueEditorDraft({ ...magazineIssueEditorDraft, issue: event.target.value })} placeholder="請寫出本篇文章真正要處理的法律問題與判斷分岔" /></label>
            <footer><button type="button" onClick={() => setMagazineIssueEditorDraft(null)}>取消</button><button type="button" className="primary-btn" onClick={() => void saveMagazineIssueEditor()}>儲存文章分析</button></footer>
          </section>
        </div>
      )}
      {coursePreviewResource && (
        <div className="course-preview-backdrop" role="presentation" onClick={() => setCoursePreviewResource(null)}>
          <section className="course-preview-modal" role="dialog" aria-modal="true" aria-labelledby="course-preview-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>學生端課程預覽</span>
                <h2 id="course-preview-title">{coursePreviewResource.title}</h2>
              </div>
              <button type="button" onClick={() => setCoursePreviewResource(null)} aria-label="關閉預覽">×</button>
            </header>
            <div className="course-preview-note">這裡依前台實際呈現檢查影片與時間點重點；不顯示逐字字幕。</div>
            <div className="course-preview-layout">
              <div className="course-preview-main">
                <div className="course-preview-player">
                  {youtubeEmbedUrl(coursePreviewResource.sourceUrl, coursePreviewTime) ? (
                    <iframe key={`${coursePreviewResource.id}-${coursePreviewTime}`} src={youtubeEmbedUrl(coursePreviewResource.sourceUrl, coursePreviewTime)} title={`${coursePreviewResource.title}課程預覽`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                  ) : coursePreviewResource.sourceUrl ? (
                    <CourseVideoPlayer
                      resourceId={coursePreviewResource.id}
                      sourceUrl={coursePreviewResource.sourceUrl}
                      title={`${coursePreviewResource.title}課程預覽`}
                      startSeconds={coursePreviewTime}
                      seekToken={coursePreviewSeekToken}
                      onTimeChange={(seconds) => setCoursePreviewTime(Math.floor(seconds))}
                      onError={setCoursePreviewError}
                    />
                  ) : (
                    <div className="course-preview-empty">尚未設定課程播放網址</div>
                  )}
                </div>
                <div className="course-preview-current">目前預覽時間：{formatMediaTime(coursePreviewTime)}</div>
                {coursePreviewError && <div className="course-preview-error" role="alert">{coursePreviewError}<br /><span>請確認 CloudFront 是否允許本站來源；目前後台已提供伺服器代理播放。</span></div>}
                {coursePreviewResource.sourceUrl && <a className="course-preview-external" href={coursePreviewResource.sourceUrl} target="_blank" rel="noreferrer">另開原始課程網址 ↗</a>}
              </div>
              <aside className="course-preview-summary-panel">
                <div className="course-preview-summary-heading"><div><span>課程摘要重點</span><strong>{coursePreviewSegments.length} 個重點</strong></div><small>每個重點保留一個代表時間點</small></div>
                {coursePreviewLoading ? <div className="course-preview-summary-empty">正在分析整堂課的摘要重點…</div> : coursePreviewSegments.length ? (
                  <div className="course-preview-summary-list">
                    {coursePreviewSegments.map((segment) => (
                      <button type="button" key={segment.id} onClick={() => seekCoursePreview(segment.startSeconds ?? 0)}>
                        <span>{formatMediaTime(segment.startSeconds)}</span>
                        <div><strong>{segment.title || "課程重點"}</strong><p>{segment.summary || "此段已標記為前台推薦重點。"}</p></div>
                      </button>
                    ))}
                  </div>
                ) : <div className="course-preview-summary-empty">尚未產生課程摘要。請在「校正字幕／重點」中按「AI 整理課程摘要重點」。</div>}
              </aside>
            </div>
            <footer className="course-preview-footer"><span>目前狀態：{coursePreviewResource.status === "active" ? "已發布" : "草稿／待確認"}</span><button type="button" onClick={() => { setCoursePreviewResource(null); void openSubtitleEditor(coursePreviewResource); }}>前往校正字幕／重點</button></footer>
          </section>
        </div>
      )}
      {subtitleCourse && (
        <div className="subtitle-editor-backdrop">
          <section className="subtitle-editor">
            <header>
              <div>
                <span>字幕校正與重點摘要</span>
                <h2>{subtitleCourse.title}</h2>
              </div>
              <button onClick={() => setSubtitleCourse(null)}>×</button>
            </header>
            <div className="subtitle-workspace">
              <div className="course-reference">
                <div className="course-reference-player">
                  {youtubeEmbedUrl(subtitleCourse.sourceUrl, coursePreviewTime) ? (
                    <iframe key={`${subtitleCourse.id}-${coursePreviewTime}`} src={youtubeEmbedUrl(subtitleCourse.sourceUrl, coursePreviewTime)} title={`${subtitleCourse.title}課程畫面`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                  ) : directVideoUrl(subtitleCourse.sourceUrl) ? (
                    <CourseVideoPlayer
                      resourceId={subtitleCourse.id}
                      sourceUrl={subtitleCourse.sourceUrl}
                      title={`${subtitleCourse.title}課程畫面`}
                      startSeconds={coursePreviewTime}
                      seekToken={coursePreviewSeekToken}
                      onTimeChange={(seconds) => setCoursePreviewTime(Math.floor(seconds))}
                      onError={setCoursePreviewError}
                    />
                  ) : subtitleCourse.sourceUrl ? (
                    <iframe key={`${subtitleCourse.id}-${coursePreviewTime}`} src={`${subtitleCourse.sourceUrl}${subtitleCourse.sourceUrl.includes("#") ? "&" : "#"}t=${coursePreviewTime}`} title={`${subtitleCourse.title}課程畫面`} allow="autoplay; fullscreen; picture-in-picture" />
                  ) : (
                    <div className="course-preview-empty">尚未設定課程播放網址</div>
                  )}
                </div>
                <div className="course-preview-current">目前預覽時間：{formatMediaTime(coursePreviewTime)}　點選右側「跳到這段」即可對照課程。</div>
                <a
                  href={subtitleCourse.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  若畫面無法嵌入，另開課程頁對照 ↗
                </a>
                <button
                  onClick={analyzeCourseSegments}
                  disabled={analyzingSegments}
                >
                  {analyzingSegments
                    ? "AI 分析中，請稍候…"
                    : "AI 整理課程摘要重點"}
                </button>
                <p>AI 會提出重要度與摘要，管理員確認後才供前台推薦。</p>
              </div>
              <div className="subtitle-list">
                {subtitleSegments
                  .slice((segmentPage - 1) * 10, segmentPage * 10)
                  .map((segment) => (
                    <article
                      key={segment.id}
                      className={segment.recommended ? "recommended" : ""}
                    >
                      <div className="segment-time">
                        <input
                          type="number"
                          value={segment.startSeconds}
                          onChange={(e) =>
                            setSubtitleSegments((current) =>
                              current.map((item) =>
                                item.id === segment.id
                                  ? {
                                      ...item,
                                      startSeconds: Number(e.target.value),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <span>至</span>
                        <input
                          type="number"
                          value={segment.endSeconds}
                          onChange={(e) =>
                            setSubtitleSegments((current) =>
                              current.map((item) =>
                                item.id === segment.id
                                  ? {
                                      ...item,
                                      endSeconds: Number(e.target.value),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <button type="button" onClick={() => seekCoursePreview(segment.startSeconds ?? 0)}>跳到這段</button>
                      </div>
                      <textarea
                        value={segment.text}
                        onChange={(e) =>
                          setSubtitleSegments((current) =>
                            current.map((item) =>
                              item.id === segment.id
                                ? { ...item, text: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <input
                        className="segment-summary"
                        value={segment.summary}
                        placeholder="重點摘要（AI 分析或人工填寫）"
                        onChange={(e) =>
                          setSubtitleSegments((current) =>
                            current.map((item) =>
                              item.id === segment.id
                                ? { ...item, summary: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      {segment.summary && <div className="segment-summary-preview"><b>重點摘要</b><span>{segment.summary}</span></div>}
                      <footer>
                        <label>
                          重要度
                          <select
                            value={segment.importance}
                            onChange={(e) =>
                              setSubtitleSegments((current) =>
                                current.map((item) =>
                                  item.id === segment.id
                                    ? {
                                        ...item,
                                        importance: Number(e.target.value),
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {[0, 1, 2, 3, 4, 5].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={segment.recommended}
                            onChange={(e) =>
                              setSubtitleSegments((current) =>
                                current.map((item) =>
                                  item.id === segment.id
                                    ? { ...item, recommended: e.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />{" "}
                          前台推薦
                        </label>
                        <button onClick={() => saveSegment(segment)}>
                          儲存校正
                        </button>
                      </footer>
                    </article>
                  ))}
              </div>
            </div>
            <nav className="document-pagination">
              <button
                disabled={segmentPage === 1}
                onClick={() => setSegmentPage((page) => page - 1)}
              >
                上一頁
              </button>
              <span>
                第 {segmentPage} /{" "}
                {Math.max(1, Math.ceil(subtitleSegments.length / 10))} 頁
              </span>
              <button
                disabled={
                  segmentPage >= Math.ceil(subtitleSegments.length / 10)
                }
                onClick={() => setSegmentPage((page) => page + 1)}
              >
                下一頁
              </button>
            </nav>
          </section>
        </div>
      )}
      {editingListening && (
        <div className="subtitle-editor-backdrop">
          <section className="listening-editor">
            <header>
              <div>
                <span>聽解題聞稿、分段配音與字幕</span>
                <h2>{editingListening.title}</h2>
              </div>
              <button onClick={() => setEditingListening(null)}>×</button>
            </header>
            <label>
              標題
              <input
                value={editingListening.title}
                onChange={(e) =>
                  setEditingListening({
                    ...editingListening,
                    title: e.target.value,
                  })
                }
              />
            </label>
            <label>
              原始題目
              <textarea
                rows={5}
                value={editingListening.questionText}
                onChange={(e) =>
                  setEditingListening({
                    ...editingListening,
                    questionText: e.target.value,
                  })
                }
              />
            </label>
            <label>
              配音聞稿
              <textarea
                className="narration-editor"
                rows={14}
                value={editingListening.narrationScript}
                onChange={(e) =>
                  setEditingListening({
                    ...editingListening,
                    narrationScript: e.target.value,
                  })
                }
              />
            </label>
            <div className="listening-segment-tools">
              <button
                type="button"
                onClick={() => downloadListeningTxt(editingListening)}
              >
                下載聞稿 TXT
              </button>
              <label>
                依序上傳多段音檔
                <input
                  type="file"
                  multiple
                  accept="audio/*,.mp3,.m4a,.wav"
                  hidden
                  onChange={(e) => uploadListeningSegments(e.target.files)}
                />
              </label>
              <label>
                上傳整份 SRT
                <input
                  type="file"
                  accept=".srt"
                  hidden
                  onChange={(e) => uploadListeningSrt(e.target.files?.[0])}
                />
              </label>
              <div>
                <input
                  type="number"
                  value={subtitleOffset}
                  onChange={(e) => setSubtitleOffset(Number(e.target.value))}
                  aria-label="字幕偏移秒數"
                />
                <button type="button" onClick={applySubtitleOffset}>
                  字幕整體偏移
                </button>
              </div>
            </div>
            <div className="audio-segment-list">
              {listeningSegments.map((segment) => {
                const segmentEnd =
                  segment.startOffsetSeconds + segment.durationSeconds;
                const segmentCues = listeningCues.filter(
                  (cue) =>
                    cue.startSeconds >= segment.startOffsetSeconds &&
                    cue.startSeconds < segmentEnd,
                );
                return (
                  <details key={segment.id}>
                    <summary>
                      <b>
                        第 {segment.sequence + 1} 段 · {segment.fileName}
                      </b>
                      <span>
                        {segment.startOffsetSeconds}s–{segmentEnd}s ·{" "}
                        {segmentCues.length} 段文字
                      </span>
                      <i>展開校正</i>
                    </summary>
                    <div className="segment-detail">
                      <audio
                        controls
                        preload="none"
                        src={`/api/listening/segments/audio?id=${segment.id}`}
                      />
                      <div className="segment-buttons">
                        <label>
                          取代此段音檔
                          <input
                            type="file"
                            accept="audio/*,.mp3,.m4a,.wav"
                            hidden
                            onChange={(e) =>
                              replaceListeningSegment(
                                segment,
                                e.target.files?.[0],
                              )
                            }
                          />
                        </label>
                        <label>
                          重傳此段 SRT
                          <input
                            type="file"
                            accept=".srt"
                            hidden
                            onChange={(e) =>
                              uploadListeningSrt(
                                e.target.files?.[0],
                                segment.id,
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeListeningSegment(segment.id)}
                        >
                          移除
                        </button>
                      </div>
                      <div className="segment-cues">
                        {segmentCues.length ? (
                          segmentCues.map((cue) => (
                            <article key={cue.id}>
                              <div>
                                <input
                                  type="number"
                                  value={cue.startSeconds}
                                  onChange={(e) =>
                                    setListeningCues((current) =>
                                      current.map((item) =>
                                        item.id === cue.id
                                          ? {
                                              ...item,
                                              startSeconds: Number(
                                                e.target.value,
                                              ),
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                                <span>至</span>
                                <input
                                  type="number"
                                  value={cue.endSeconds}
                                  onChange={(e) =>
                                    setListeningCues((current) =>
                                      current.map((item) =>
                                        item.id === cue.id
                                          ? {
                                              ...item,
                                              endSeconds: Number(
                                                e.target.value,
                                              ),
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </div>
                              <textarea
                                value={cue.text}
                                onChange={(e) =>
                                  setListeningCues((current) =>
                                    current.map((item) =>
                                      item.id === cue.id
                                        ? { ...item, text: e.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                              <button
                                type="button"
                                onClick={() => saveListeningCue(cue)}
                              >
                                儲存文字
                              </button>
                            </article>
                          ))
                        ) : (
                          <p>這段尚未配對字幕，可上傳此段 SRT。</p>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
            <p className="subtitle-summary">
              {listeningSegments.length} 段音檔 · {listeningCues.length}{" "}
              段字幕。整份 SRT 使用合併後時間軸；各段 SRT 可從 00:00
              開始，系統會自動加上該段起始時間。
            </p>
            <footer>
              <button onClick={() => saveListening(editingListening, "draft")}>
                儲存草稿
              </button>
              <button
                className="publish-listening"
                disabled={!listeningSegments.length}
                onClick={() => saveListening(editingListening, "published")}
              >
                發布聽解題
              </button>
            </footer>
          </section>
        </div>
      )}
      {activeTab === "legal" && (
        <section className="panel data-hub">
          <div className="cost-heading">
            <div>
              <h2>法規與憲法法庭資料</h2>
              <p className="panel-sub">
                全國法規 ZIP 會自動讀取法律與命令，再分批建立索引；完成解析後才供 AI 導師引用。
              </p>
            </div>
            <span className="source-count">
              {legalSources
                .reduce((sum, item) => sum + item.documentCount, 0)
                .toLocaleString()}{" "}
              筆
            </span>
          </div>
          {notice && <div className="notice">{notice}</div>}
          <div className="data-source-grid">
            {legalSources.map((source) => (
              <article key={source.sourceKey}>
                <header>
                  <span>{source.category}</span>
                  <em className={`data-status ${source.status}`}>
                    {source.status === "ready"
                      ? "可供搜尋"
                      : source.status === "uploaded"
                        ? "ZIP 已上傳"
                      : source.status === "importing"
                        ? "匯入中"
                        : source.status === "failed"
                          ? "失敗"
                          : source.status === "downloading"
                            ? "下載中"
                            : "尚未下載"}
                  </em>
                </header>
                <h3>{source.label}</h3>
                <p>
                  {source.sourceKey === "moj-regulations"
                    ? "法務部官方全國法規資料，內含法律與命令"
                    : "司法院憲法法庭官方資料"}
                </p>
                <div className="data-metrics">
                  <div>
                    <b>{source.documentCount.toLocaleString()}</b>
                    <small>文件</small>
                  </div>
                  <div>
                    <b>{source.articleCount.toLocaleString()}</b>
                    <small>條文</small>
                  </div>
                  <div>
                    <b>
                      {source.totalAvailable
                        ? `${source.importCursor || source.totalAvailable}/${source.totalAvailable}`
                        : "—"}
                    </b>
                    <small>批次進度</small>
                  </div>
                </div>
                {source.sourceKey === "moj-regulations" && (
                  <div className="data-category-summary">
                    <span>法律 {source.categoryCounts?.["法律"]?.toLocaleString() ?? "0"}</span>
                    <span>命令 {source.categoryCounts?.["命令"]?.toLocaleString() ?? "0"}</span>
                    <strong>
                      合計 {source.documentCount.toLocaleString()}
                    </strong>
                  </div>
                )}
                {source.lastError && (
                  <small className="data-error">{source.lastError}</small>
                )}
                {source.sourceKey === "moj-regulations" && (
                  <div className="legal-zip-upload">
                    <label>
                      <span>
                        {legalZipFiles[source.sourceKey]?.name ??
                          "選擇全國法規 ZIP（內含法律與命令）"}
                      </span>
                      <input
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(event) =>
                          setLegalZipFiles((current) => ({
                            ...current,
                            [source.sourceKey]: event.target.files?.[0] ?? null,
                          }))
                        }
                      />
                    </label>
                    <button
                      disabled={uploadingLegalZip !== null || syncingLegal !== null}
                      onClick={() => uploadLegalZip(source.sourceKey)}
                    >
                      {uploadingLegalZip === source.sourceKey
                        ? "上傳中…"
                        : "上傳並自動匯入"}
                    </button>
                  </div>
                )}
                <footer>
                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                    官方來源
                  </a>
                  <Link href="/plan?tab=laws">查看內容</Link>
                  <button
                    disabled={syncingLegal !== null || (source.sourceKey === "moj-regulations" && !source.hasArchive)}
                    onClick={() =>
                      source.sourceKey === "moj-regulations"
                        ? importExistingLegalZip(source.sourceKey)
                        : syncLegal(source.sourceKey, source.status === "ready")
                    }
                  >
                    {syncingLegal === source.sourceKey
                      ? "處理中…"
                      : source.sourceKey === "moj-regulations"
                        ? source.hasArchive
                          ? "重新處理已上傳 ZIP"
                          : "請先上傳 ZIP"
                        : source.status === "ready"
                          ? "重新同步"
                          : "開始下載"}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}
      {activeTab === "judicial" && (
        <section className="panel judicial-hub">
          <div className="cost-heading">
            <div>
              <h2>司法院裁判資料</h2>
              <p className="panel-sub">
                使用已儲存帳密取得 6 小時 Token；官方 API 每日 00:00 至
                06:00 開放，系統會在開放後自動持續下載。
              </p>
            </div>
            <span
              className={`source-count ${judicialStatus?.configured ? "configured" : ""}`}
            >
              {judicialStatus?.configured ? "帳密已設定" : "尚未設定"}
            </span>
          </div>
          {notice && <div className="notice">{notice}</div>}
          <div className="judicial-overview">
            <article>
              <span>裁判資料庫</span>
              <strong>
                {Number(judicialStatus?.caseCount ?? 0).toLocaleString()}
              </strong>
              <small>已保存裁判</small>
            </article>
            <article>
              <span>{judicialStatus?.schedule?.enabled ? "實際排程" : "排程狀態"}</span>
              <strong>{judicialStatus?.schedule?.time ?? "00:00"}</strong>
              <small>{judicialStatus?.schedule?.enabled ? `每 ${judicialStatus.schedule.intervalMinutes ?? 1} 分鐘自動續傳（台灣時間）` : "尚未啟用"}</small>
            </article>
            <article>
              <span>待下載</span>
              <strong>
                {Number(
                  judicialStatus?.settings?.judicial_pending_count ?? 0,
                ).toLocaleString()}
              </strong>
              <small>每批最多 120 筆續傳</small>
            </article>
          </div>
          <div className="judicial-actions">
            <button
              onClick={() => runJudicial("test")}
              disabled={syncingJudicial || !judicialStatus?.configured}
            >
              測試 API 帳密
            </button>
            <button
              className="primary-btn"
              onClick={() => runJudicial("sync")}
              disabled={syncingJudicial || !judicialStatus?.configured}
            >
              {syncingJudicial ? "同步中…" : "立即下載一批"}
            </button>
          </div>
          {judicialStatus?.schedule?.enabled && (
            <div className={`judicial-schedule-live ${judicialLaunching ? "launching" : ""}`} role="status" aria-live="polite">
              {judicialLaunching ? (
                <><span className="download-orbit" aria-hidden="true"><i /><i /><i /></span><div><b>時間到，正在啟動下載</b><small>背景 Worker 已收到本分鐘同步任務，正在取得官方清單…</small></div></>
              ) : syncingJudicial ? (
                <><span className="download-spinner" aria-hidden="true" /><div><b>正在下載本批裁判資料</b><small>完成後會自動更新同步狀態</small></div></>
              ) : (
                <><span className="countdown-clock" aria-hidden="true">⏱</span><div><b>距離下一次自動啟動</b><strong>{formatCountdown(judicialNextRun())}</strong><small>時間到會先顯示啟動動畫，再由背景自動下載；不用重新按鈕</small></div></>
              )}
            </div>
          )}
          <div className="sync-log">
            <h3>同步狀態</h3>
            <p>
              最後驗證：
              {judicialStatus?.settings?.judicial_last_auth_at
                ? new Date(
                    judicialStatus.settings.judicial_last_auth_at,
                  ).toLocaleString("zh-TW")
                : "尚未驗證"}
            </p>
            <p>
              最後同步：
              {judicialStatus?.settings?.judicial_last_sync_at
                ? new Date(
                    judicialStatus.settings.judicial_last_sync_at,
                  ).toLocaleString("zh-TW")
                : "尚未同步"}
            </p>
            <p>
              {judicialStatus?.settings?.judicial_last_sync_summary ||
                "今晚首次同步後會顯示下載與移除筆數。"}
            </p>
            {judicialStatus?.schedule?.enabled && (
              <p className="sync-auto-note">
                錯誤或中斷後會在 {judicialStatus.schedule.window ?? "00:00–05:59"} 每 {judicialStatus.schedule.intervalMinutes ?? 1} 分鐘自動恢復；不用整晚開著此頁面。
              </p>
            )}
            {!!judicialStatus?.failedCount && (
              <p className="data-error">目前待自動重試 {judicialStatus.failedCount} 筆。</p>
            )}
            {!!judicialStatus?.permanentFailureCount && (
              <p className="data-error">已有 {judicialStatus.permanentFailureCount} 筆達重試上限，仍保留錯誤紀錄。</p>
            )}
            {judicialStatus?.settings?.judicial_last_error && (
              <p className="data-error">
                {judicialStatus.settings.judicial_last_error}
              </p>
            )}
          </div>
        </section>
      )}
      {activeTab === "listening" && !editingListening && (
        <section className="panel prepared-listening-import">
          <h3>已有完成的聞稿</h3>
          <p>
            直接匯入 TXT，不呼叫 AI；建立後可上傳完整音檔、分段音檔或套件 ZIP。
          </p>
          <div>
            <input
              value={listeningTitle}
              onChange={(e) => setListeningTitle(e.target.value)}
              placeholder="節目標題（可留空使用 TXT 檔名）"
            />
            <label>
              選擇 TXT
              <input
                type="file"
                accept=".txt,text/plain"
                hidden
                onChange={(e) => setPreparedTxt(e.target.files?.[0] ?? null)}
              />
            </label>
            <button disabled={!preparedTxt} onClick={importPreparedListening}>
              匯入 {preparedTxt?.name || "TXT"}
            </button>
          </div>
        </section>
      )}
      {editingListening && (
        <div className="zip-import-float">
          <label>
            匯入套件 ZIP
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => uploadListeningZip(e.target.files?.[0])}
            />
          </label>
        </div>
      )}
      {chapterViewer && (
        <div
          className="chapter-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setChapterViewer(null);
          }}
        >
          <section className="chapter-viewer" role="dialog" aria-modal="true" aria-labelledby="chapter-viewer-title">
            <header className="chapter-viewer-header">
              <div>
                <span>教材拆解檢視</span>
                <h2 id="chapter-viewer-title">{chapterViewer.resource.title}</h2>
                <p>
                  已載入 {chapterViewer.rows.length} 筆真實章節／題型
                  {chapterViewer.incompleteCount ? ` · ${chapterViewer.incompleteCount} 筆仍只有目錄資料` : ""}
                </p>
              </div>
              <button type="button" aria-label="關閉章節內容" onClick={() => setChapterViewer(null)}>×</button>
            </header>
            {chapterViewer.message && <div className="chapter-viewer-message">{chapterViewer.message}</div>}
            {chapterViewer.sourceFailures?.length ? (
              <details className="chapter-viewer-failures">
                <summary>{chapterViewer.sourceFailures.length} 章尚未定位原文（查看原因）</summary>
                <ul>
                  {chapterViewer.sourceFailures.map((failure) => (
                    <li key={failure.segmentId}><strong>{failure.title}</strong><span>{failure.error}</span></li>
                  ))}
                </ul>
              </details>
            ) : null}
            {chapterViewer.rows.length ? (
              <div className="chapter-viewer-layout">
                <aside className="chapter-viewer-index" aria-label="部、主題與完整題型">
                  <div className="chapter-viewer-index-heading"><strong>部・主題・題型</strong><span>{chapterViewer.rows.length} 題</span></div>
                  <div className="chapter-viewer-index-list">
                    {chapterViewer.rows.map((chapter, index) => {
                      const [section = "未分類部分", topic = "未分類主題"] = (chapter.lessonLabel || "").split("｜");
                      const previous = chapterViewer.rows[index - 1];
                      const [previousSection = "", previousTopic = ""] = (previous?.lessonLabel || "").split("｜");
                      return (
                        <Fragment key={`${chapter.id}-${chapter.sequence}`}>
                          {section !== previousSection && <div className="chapter-viewer-part">{section}</div>}
                          {(section !== previousSection || topic !== previousTopic) && <div className="chapter-viewer-topic">{topic}</div>}
                          <button
                            type="button"
                            className={activeChapter?.id === chapter.id ? "active" : ""}
                            onClick={() => setSelectedChapterId(chapter.id)}
                          >
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <strong>{chapter.title || "未命名題型"}</strong>
                            <small>題型{chapter.pageStart ? ` · PDF p.${chapter.pageStart}${chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""}` : " · 頁碼待核對"}</small>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                </aside>
                <article className="chapter-viewer-content">
                  {activeChapter ? (
                    <>
                      <div className="chapter-viewer-content-meta">
                        <span>{activeChapter.lessonLabel || "教材章節"}</span>
                        <em>{activeChapter.reviewStatus === "ai_reviewed" ? "AI 已整理" : activeChapter.reviewStatus === "catalogue_only" ? "目錄已保存" : activeChapter.reviewStatus}</em>
                      </div>
                      <h3>{activeChapter.title || "未命名章節"}</h3>
                      <small className="chapter-viewer-pages">原教材頁碼：{activeChapter.pageStart ? `${activeChapter.pageStart}${activeChapter.pageEnd && activeChapter.pageEnd !== activeChapter.pageStart ? `–${activeChapter.pageEnd}` : ""}` : "待核對"}</small>
                      {activeChapter.summary && <div className="chapter-viewer-summary"><strong>拆解摘要</strong><p>{activeChapter.summary}</p></div>}
                      {activeChapter.text ? (() => {
                        const sections = problemContentSections(activeChapter.text);
                        return sections ? (
                          <div className="chapter-viewer-problem-sections">
                            <section className="chapter-viewer-text question"><strong>完整題目</strong><p>{sections.question}</p></section>
                            <section className="chapter-viewer-text analysis"><strong>{sections.label}</strong><p>{sections.analysis}</p></section>
                          </div>
                        ) : (
                          <div className="chapter-viewer-text"><strong>完整內容／題目原文</strong><p>{activeChapter.text}</p></div>
                        );
                      })() : (
                        <div className="chapter-viewer-empty">目前已確認這個真實目錄項目，但完整內容仍在後台分批整理；系統不會用假資料補上。</div>
                      )}
                    </>
                  ) : <div className="chapter-viewer-empty">尚未選擇章節。</div>}
                </article>
              </div>
            ) : (
              <div className="chapter-viewer-empty">目前沒有可查看的章節資料。請先完成教材索引，再按「建立章節索引」。</div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
