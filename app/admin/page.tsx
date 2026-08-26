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
  editorTotals?: { requests: number; inputTokens: number; cachedTokens: number; outputTokens: number; costMicros: number };
  editorRecent?: Array<{ id: number; model: string; source: string; inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsdMicros: number; createdAt: string }>;
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
          body: form,
        });
        if (!response.ok) throw new Error(audioFile.name);
      }
      const srtName = Object.keys(entries).find((name) =>
        name.toLowerCase().endsWith(".srt"),
      );
      if (srtName)
        await uploadListeningSrt(
          new File(
            [entries[srtName]],
            srtName.split("/").pop() || "subtitles.srt",
            { type: "application/x-subrip" },
          ),
          undefined,
          targetItem,
        );
      const txtNames = Object.keys(entries).filter((name) =>
        name.toLowerCase().endsWith(".txt"),
      );
      if (txtNames.length) {
        const decoder = new TextDecoder();
        const candidates = txtNames.map((name) => ({
          name,
          text: decoder.decode(entries[name]),
        }));
        const selected = candidates.sort(
          (a, b) =>
            (b.text.match(/[為與臺條題應將]/g) || []).length -
            (a.text.match(/[為與臺條題應將]/g) || []).length,
        )[0];
        if (
          selected.text.trim() &&
          window.confirm(
            `ZIP 內找到 ${txtNames.length} 份 TXT，是否以「${selected.name.split("/").pop()}」更新目前聞稿？`,
          )
        ) {
          const updated = {
            ...targetItem,
            narrationScript: selected.text.trim(),
          };
          await saveListening(updated, updated.status);
        }
      }
      await openListeningEditor(targetItem);
      setNotice(
        `ZIP 已完成：匯入 ${names.length} 段音檔${srtName ? "與 SRT 字幕" : ""}；已忽略重複的完整合併音檔。`,
      );
    } catch {
      setNotice("ZIP 解析或分段上傳失敗，請確認檔案未加密且音檔格式正確。");
    }
  }

  async function importListeningPackage() {
    if (!listeningPackageFile) return;
    setNotice("正在讀取聽解題 ZIP 套件…");
    try {
      const entries = unzipSync(
        new Uint8Array(await listeningPackageFile.arrayBuffer()),
      );
      const txtNames = Object.keys(entries).filter((name) =>
        name.toLowerCase().endsWith(".txt"),
      );
      if (!txtNames.length) {
        setNotice("這個 ZIP 沒有 TXT 聞稿，請先在下方建立聞稿再匯入 ZIP。");
        return;
      }
      const decoder = new TextDecoder();
      const candidates = txtNames.map((name) => ({
        name,
        text: decoder.decode(entries[name]),
      }));
      const selected = candidates.sort(
        (a, b) =>
          (b.text.match(/[為與臺條題應將]/g) || []).length -
          (a.text.match(/[為與臺條題應將]/g) || []).length,
      )[0];
      const txtFile = new File(
        [new TextEncoder().encode(selected.text)],
        selected.name.split("/").pop() || "聞稿.txt",
        { type: "text/plain" },
      );
      const form = new FormData();
      form.set("preparedTxt", txtFile);
      form.set("title", listeningTitle || selected.name.replace(/\.txt$/i, ""));
      form.set("questionText", listeningQuestionText || "ZIP 套件匯入題目");
      form.set("subject", "刑法");
      const response = await fetch("/api/listening", {
        method: "POST",
        body: form,
      });
      const result = (await readJson(response)) as {
        item?: ListeningItem;
        error?: string;
      };
      if (!response.ok || !result.item) {
        setNotice(String(result.error || "ZIP 題目建立失敗"));
        return;
      }
      setListeningItems((current) => [result.item!, ...current]);
      setEditingListening(result.item);
      setListeningPackageFile(null);
      setListeningTitle("");
      setListeningQuestionText("");
      await uploadListeningZip(listeningPackageFile, result.item);
      setNotice("ZIP 已建立為一道聽解題，音檔、SRT 與 TXT 已開始配對。");
    } catch {
      setNotice("ZIP 解析失敗，請確認檔案未加密且包含 TXT、音檔或 SRT。");
    }
  }

  async function uploadListeningSrt(
    file?: File,
    segmentId?: number,
    targetItem: ListeningItem | null = editingListening,
  ) {
    if (!targetItem || !file) return;
    const form = new FormData();
    form.set("action", "subtitle");
    form.set("listeningId", String(targetItem.id));
    form.set("file", file);
    if (segmentId) form.set("segmentId", String(segmentId));
    const response = await fetch("/api/listening/segments", {
      method: "POST",
      body: form,
    });
    const result = await readJson(response);
    if (!response.ok) {
      setNotice(String(result.error || "字幕上傳失敗"));
      return;
    }
    await openListeningEditor(targetItem);
    setNotice(
      segmentId
        ? "此段 SRT 已加上音檔累計時間並完成對齊。"
        : `整份 SRT 已建立 ${result.cues ?? 0} 段字幕${result.autoMapped ? `，自動分配到 ${result.mappedSegments ?? 0} 段音檔` : ""}${result.unmapped ? `，另有 ${result.unmapped} 段待確認` : ""}。`,
    );
  }

  async function removeListeningSegment(id: number) {
    if (!editingListening || !window.confirm("確定移除此段音檔？")) return;
    await fetch(`/api/listening/segments?id=${id}`, { method: "DELETE" });
    await openListeningEditor(editingListening);
  }
  async function applySubtitleOffset() {
    if (!editingListening || !subtitleOffset) return;
    await fetch("/api/listening/segments", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listeningId: editingListening.id,
        offsetSeconds: subtitleOffset,
      }),
    });
    setSubtitleOffset(0);
    await openListeningEditor(editingListening);
    setNotice("字幕整體偏移已套用。");
  }

  function downloadListeningTxt(item: ListeningItem) {
    const blob = new Blob(
      [
        `${item.title}\n\n${item.questionText}\n\n【配音聞稿】\n${item.narrationScript}`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.title.replace(/[\\/:*?"<>|]/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadExamQuestions(page = questionPage) {
    const params = new URLSearchParams({ page: String(page), status: questionStatus, examType: questionExamType, examCategory: questionExamCategory });
    if (questionYear !== "all") params.set("year", questionYear);
    if (questionSubject !== "all") params.set("subject", questionSubject);
    const response = await fetch(
      `/api/exam-questions?${params.toString()}`,
    );
    if (!response.ok) return;
    const result = (await response.json()) as {
      items?: ExamQuestion[];
      total?: number;
      totals?: Record<string, number>;
      examTypeTotals?: Record<string, number>;
      filters?: QuestionFilterOptions;
    };
    setExamQuestions(result.items ?? []);
    setQuestionTotal(result.total ?? 0);
    setQuestionTotals(result.totals ?? {});
    setQuestionTypeTotals(result.examTypeTotals ?? {});
    setQuestionFilterOptions(result.filters ?? { years: [], subjects: [] });
  }
  async function publishQuestions(ids?: number[], all = false) {
    const response = await fetch("/api/exam-questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        all ? { publishAllDrafts: true, examCategory: questionExamCategory } : { ids, status: "published" },
      ),
    });
    const result = await readJson(response);
    setNotice(response.ok ? `已發布 ${result.updated ?? 0} 題，前台練真題現在可直接讀取。` : result.error ?? "題目發布失敗");
    await loadExamQuestions(questionPage);
  }

  async function fetchTeacherAnswers(ids: number[]) {
    if (!ids.length || fetchingTeacherAnswers) return;
    setFetchingTeacherAnswers(true);
    setNotice("正在從高點真題 PDF 核對老師參考擬答；完成後會回到本頁更新狀態…");
    const response = await fetch("/api/exam-questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "fetch-teacher-answers", ids }) });
    const result = await readJson(response) as { updated?: number; requested?: number; failures?: string[]; error?: string };
    setNotice(response.ok ? `本次已抓到 ${result.updated ?? 0} / ${result.requested ?? ids.length} 題老師擬答${result.failures?.length ? `；${result.failures[0]}` : ""}` : result.error ?? "老師擬答抓取失敗");
    await loadExamQuestions(questionPage);
    setFetchingTeacherAnswers(false);
  }

  function openQuestionEditor(question: ExamQuestion) {
    setEditingQuestion({
      id: question.id,
      examType: question.examType,
      year: question.year,
      examName: question.examName || "類科待辨識",
      subject: question.subject,
      questionNumber: question.questionNumber,
      stem: question.stem,
      teacherAnswer: question.teacherAnswer ?? "",
      teacherNotes: question.teacherNotes ?? "",
      rubricJson: question.rubricJson ?? "[]",
      status: question.status,
      sourceUrl: question.sourceUrl,
    });
  }

  async function saveQuestion() {
    if (!editingQuestion || savingQuestion) return;
    setSavingQuestion(true);
    let rubricJson = editingQuestion.rubricJson || "[]";
    try {
      const parsed = JSON.parse(rubricJson);
      if (!Array.isArray(parsed)) throw new Error("評分依據必須是陣列");
      rubricJson = JSON.stringify(parsed);
    } catch {
      setNotice("評分依據格式不正確，請保留 JSON 陣列格式。");
      setSavingQuestion(false);
      return;
    }
    const response = await fetch("/api/exam-questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", ...editingQuestion, rubricJson }),
    });
    const result = (await readJson(response)) as { question?: ExamQuestion; error?: string };
    if (!response.ok || !result.question) {
      setNotice(result.error ?? "申論題儲存失敗");
    } else {
      setNotice("申論題、老師擬答與評分依據已儲存。");
      setEditingQuestion(null);
      await loadExamQuestions(questionPage);
    }
    setSavingQuestion(false);
  }

  async function removeListening(item: ListeningItem) {
    if (!window.confirm(`確定移除「${item.title}」？`)) return;
    const response = await fetch(`/api/listening?id=${item.id}`, {
      method: "DELETE",
    });
    if (!response.ok) return;
    setListeningItems((current) => current.filter((row) => row.id !== item.id));
    if (editingListening?.id === item.id) setEditingListening(null);
    setNotice("聽解題項目已移除。");
  }

  async function uploadResourceAsset(
    resourceId: number,
    assetType: "cover" | "subtitle",
    file?: File,
  ) {
    if (!file) return;
    const form = new FormData();
    form.set("resourceId", String(resourceId));
    form.set("assetType", assetType);
    form.set("file", file);
    setNotice(
      assetType === "cover"
        ? "正在上傳書封…"
        : "正在解析字幕並建立可搜尋時間片段…",
    );
    const response = await fetch("/api/resources/assets", {
      method: "POST",
      body: form,
    });
    const result = (await readJson(response)) as {
      segments?: number;
      error?: string;
    };
    if (!response.ok) {
      setNotice(result.error ?? "檔案處理失敗");
      return;
    }
    setResources((current) =>
      current.map((item) =>
        item.id === resourceId
          ? {
              ...item,
              hasCover: assetType === "cover" ? 1 : item.hasCover,
              segmentCount:
                assetType === "subtitle"
                  ? Number(result.segments ?? 0)
                  : item.segmentCount,
            }
          : item,
      ),
    );
    if (assetType === "cover") {
      setNotice("書封已更新。");
      return;
    }

    setNotice(`字幕已解析 ${result.segments ?? 0} 段；正在由 AI 整理整堂課的摘要重點…`);
    const analysisResponse = await fetch("/api/resources/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId }),
    });
    const analysis = (await readJson(analysisResponse)) as {
      analyzed?: number;
      digestCount?: number;
      error?: string;
    };
    if (analysisResponse.ok) {
      setNotice(`字幕已完成：保留 ${result.segments ?? 0} 段原始字幕，AI 已整理 ${analysis.digestCount ?? analysis.analyzed ?? 0} 個摘要重點。`);
    } else {
      setNotice(`字幕已建立 ${result.segments ?? 0} 段，但 AI 分析未完成：${analysis.error ?? "請稍後在字幕校正視窗重新分析。"}`);
    }
  }

  async function repairResourceSubtitles(resourceId: number, silent = false) {
    const response = await fetch("/api/resources/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId, action: "repair" }),
    });
    const result = (await readJson(response)) as {
      repaired?: boolean;
      segments?: number;
      error?: string;
    };
    if (!response.ok) {
      if (!silent) setNotice(result.error ?? "字幕整理失敗");
      return;
    }
    if (result.repaired) {
      setResources((current) =>
        current.map((item) =>
          item.id === resourceId
            ? { ...item, segmentCount: Number(result.segments ?? item.segmentCount) }
            : item,
        ),
      );
      if (!silent) setNotice(`字幕已重新整理，建立 ${result.segments ?? 0} 個時間片段。`);
    } else if (!silent) {
      setNotice("目前字幕已是時間片段格式，不需要重新整理。");
    }
  }

  async function analyzeMagazine(url?: string) {
    const sourceUrl = typeof url === "string" ? url : magazineUrl;
    if (!sourceUrl.trim()) {
      setNotice("請先填寫法學教室期數網址。");
      return false;
    }
    const isHistoryUrl = /m_search\.asp/i.test(sourceUrl);
    try {
      if (isHistoryUrl) {
        setSyncingMagazineYear(true);
        setNotice(`正在讀取 ${magazineYear} 年全部期數…`);
      const discoveryResponse = await fetch("/api/resources/magazine-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, discoverYear: magazineYear }),
      });
      const discovery = (await readJson(discoveryResponse)) as { year?: number; issues?: Array<{ url: string; title: string }>; error?: string };
      if (!discoveryResponse.ok || !discovery.issues?.length) {
        setNotice(discovery.error ?? "今年尚未找到可同步的法學教室期數");
        return false;
      }
      let completed = 0;
      let indexed = 0;
      let failed = 0;
      for (const [index, issue] of discovery.issues.entries()) {
        setNotice(`正在處理 ${issue.title}（${index + 1}/${discovery.issues.length}）…`);
        const issueResponse = await fetch("/api/resources/magazine-import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: issue.url }),
        });
        const issueResult = (await readJson(issueResponse)) as { indexed?: number; failures?: string[] };
        if (issueResponse.ok) {
          completed++;
          indexed += issueResult.indexed ?? 0;
          failed += issueResult.failures?.length ?? 0;
        } else failed++;
      }
      const refreshed = await fetch("/api/resources");
      if (refreshed.ok) {
        const refreshedResult = (await refreshed.json()) as { resources?: LearningResource[] };
        setResources(refreshedResult.resources ?? []);
      }
      setMagazineListYear(magazineYear);
      setNotice(`已同步 ${discovery.year ?? "今年"} 年 ${completed}/${discovery.issues.length} 期，共完成 ${indexed} 篇試讀分析${failed ? `；${failed} 篇需重試或人工確認` : ""}。`);
      return completed > 0;
      }
      setNotice("正在分析指定期數、試讀文章與可用連結…");
      const response = await fetch("/api/resources/magazine-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const result = (await readJson(response)) as {
        resource?: LearningResource;
        articles?: number;
        indexed?: number;
        failures?: string[];
        error?: string;
      };
      if (!response.ok || !result.resource) {
        setNotice(result.error ?? "月旦法學教室分析失敗");
        return false;
      }
      const refreshed = await fetch("/api/resources");
      if (refreshed.ok) {
        const refreshedResult = (await refreshed.json()) as { resources?: LearningResource[] };
        setResources(refreshedResult.resources ?? []);
      } else {
        setResources((current) => current.some((item) => item.id === result.resource!.id) ? current : [result.resource!, ...current]);
      }
      setNotice(
        `已分析 ${result.articles ?? 0} 個試讀入口，${result.indexed ?? 0} 篇 PDF 已完成解析並可供 AI 搜尋${result.failures?.length ? `；${result.failures.length} 篇暫時失敗，可再次按「自動分析」重試` : ""}。`,
      );
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? `抓取失敗：${error.message}` : "抓取失敗，請稍後再試。");
      return false;
    } finally {
      if (isHistoryUrl) setSyncingMagazineYear(false);
    }
  }

  async function createMagazineIssue(event: FormEvent) {
    event.preventDefault();
    if (!magazineIssueTitle.trim() || !magazineIssueUrl.trim()) {
      setNotice("請填寫期數名稱與本期來源網址。");
      return;
    }
    setCreatingMagazineIssue(true);
    setNotice("正在建立指定期數…");
    try {
      const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: "magazine",
        title: magazineIssueTitle.trim(),
        subject: "綜合",
        creator: "元照出版公司",
        sourceUrl: magazineIssueUrl.trim(),
        accessType: "external",
        status: "draft",
      }),
    });
      const result = (await readJson(response)) as { resource?: LearningResource; error?: string };
      if (!response.ok || !result.resource) {
        setNotice(result.error ?? "法學教室期數建立失敗");
        return;
      }
      const issueUrl = magazineIssueUrl.trim();
      setMagazineUrl(issueUrl);
      setNotice("期數已建立，正在抓取試讀文章並分析…");
      const analyzed = await analyzeMagazine(issueUrl);
      if (analyzed) {
        setMagazineIssueTitle("");
        setMagazineIssueUrl("");
      }
    } catch (error) {
      setNotice(error instanceof Error ? `新增失敗：${error.message}` : "新增失敗，請稍後再試。");
    } finally {
      setCreatingMagazineIssue(false);
    }
  }

  async function publishMagazine(resource: LearningResource) {
    const response = await fetch("/api/resources", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...resource, status: "active" }) });
    const result = (await readJson(response)) as { resource?: LearningResource; error?: string };
    if (!response.ok || !result.resource) { setNotice(result.error ?? "法學教室發布失敗"); return; }
    setResources((current) => current.map((item) => item.id === resource.id ? { ...item, ...result.resource } : item));
    setNotice(`${resource.title} 已發布到首頁法教專區。`);
  }

  async function bindBookDocument(
    resource: LearningResource,
    documentId: string,
  ) {
    const response = await fetch("/api/resources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...resource, documentId: documentId || null }),
    });
    const result = (await readJson(response)) as {
      resource?: LearningResource;
      error?: string;
    };
    if (!response.ok || !result.resource) {
      setNotice(result.error ?? "教材綁定失敗");
      return;
    }
    setResources((current) =>
      current.map((item) =>
        item.id === resource.id
          ? { ...item, documentId: result.resource!.documentId }
          : item,
      ),
    );
    setNotice(
      `${resource.title} 已${documentId ? "綁定教材文件" : "解除教材綁定"}。`,
    );
    if (documentId && result.resource.documentStatus === "completed" && isProblemSolvingResource(result.resource)) {
      void startAutomaticChapterIndex(result.resource);
    }
  }

  async function buildBookChapters(resource: LearningResource, restart = false) {
    if (chapterBuildRunningRef.current.has(resource.id)) return;
    if (!resource.documentId) {
      setNotice("請先替這本書綁定已完成索引的教材文件。");
      return;
    }
    chapterBuildRunningRef.current.add(resource.id);
    try {
      const previous = chapterProgress[resource.id];
      setNotice(restart
        ? isProblemSolvingResource(resource)
          ? `正在逐頁重新核對「${resource.title}」的題型；完成前會保留目前可用資料…`
          : `正在重新細分「${resource.title}」的篇、章、節與小節；完成前會保留目前可用資料…`
        : `正在從「${resource.title}」已建立的教材索引接續整理；不會重新上傳、刪除或重新拆解既有資料…`);
      setChapterProgress((current) => ({
        ...current,
        [resource.id]: current[resource.id] ?? {
          state: "building", phase: "outline", completedTopics: 0, totalTopics: 0, foundQuestions: 0,
        },
      }));
      let pausedRetries = 0;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await fetch("/api/resources/chapters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Never send the old `rebuild` flag: a retry must resume the saved
          // queue instead of deleting pending real rows and starting at 0%.
          body: JSON.stringify({ resourceId: resource.id, restart: restart && attempt === 0 }),
        });
        const result = (await readJson(response)) as {
          chapters?: unknown[];
          generated?: boolean;
          reused?: boolean;
          status?: string;
          progress?: ChapterProgress;
          error?: string;
        };
        if (result.progress) {
          setChapterProgress((current) => ({ ...current, [resource.id]: result.progress! }));
          if (result.progress.totalTopics) {
            setNotice(`正在解析「${resource.title}」：主題 ${result.progress.completedTopics ?? 0}／${result.progress.totalTopics}，已找到 ${result.progress.foundQuestions ?? 0} 題。`);
          }
        }
        if (!response.ok && response.status !== 202) {
          setNotice(result.error ?? "章節索引建立失敗；教材本身不會被重新拆解。");
          return;
        }
        if (result.status === "paused") {
          // Rate limits are transient. Keep the saved checkpoint and retry in
          // the same run, with a small backoff instead of requiring the user
          // to discover and press another button.
          pausedRetries += 1;
          if (pausedRetries > 8) {
            setNotice("AI 目前較忙；已保存拆解進度，系統稍後重新進入後會接續處理。");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(8000, 1200 * 2 ** Math.min(pausedRetries - 1, 3))));
          continue;
        }
        if (result.status === "failed") {
          setNotice(result.error ?? "解析未完成；原資料仍保留，稍後可接續處理。");
          return;
        }
        if (result.status === "building") {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          continue;
        }
        const count = result.chapters?.length ?? 0;
        setResources((current) => current.map((item) => item.id === resource.id ? { ...item, chapterCount: count } : item));
        setChapterProgress((current) => ({
          ...current,
          [resource.id]: result.progress ?? { ...(previous ?? {}), state: "completed", phase: "saving", foundQuestions: count },
        }));
        setNotice(result.reused
          ? `「${resource.title}」已有 ${count} 筆可用索引；這次沒有再次呼叫 AI。`
          : isProblemSolvingResource(resource)
            ? `「${resource.title}」已完成目錄整理，共 ${count} 筆真實題型。`
            : `「${resource.title}」已建立細分索引，共 ${count} 個節／細目；之後前台會直接讀取已保存內容。`);
        return;
      }
      setNotice("拆解進度已保存；系統下一次檢查會從目前主題接續，不會歸零。");
    } finally {
      chapterBuildRunningRef.current.delete(resource.id);
    }
  }

  async function scanProblemBookPages(resource: LearningResource) {
    if (!resource.documentId || chapterBuildRunningRef.current.has(resource.id)) return;
    chapterBuildRunningRef.current.add(resource.id);
    setChapterSourceRunning(resource.id);
    try {
      setNotice(`正在逐頁掃描「${resource.title}」；每批完成後立即保存，可中斷後接續。`);
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const response = await fetch("/api/resources/chapters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resourceId: resource.id, sourceBatch: true }),
        });
        const result = (await readJson(response)) as {
          status?: string; pagesDone?: number; totalPages?: number;
          chaptersReady?: number; chaptersTotal?: number; pendingCount?: number;
          pageCoverage?: { scanned: number; continuation: number; empty: number; unprocessed: number };
          message?: string; error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "逐頁拆解失敗");
        setResources((current) => current.map((item) => item.id === resource.id ? {
          ...item,
          sourcePageCount: result.pagesDone ?? item.sourcePageCount,
          chapterCount: result.chaptersReady ?? item.chapterCount,
          pendingChapterCount: result.pendingCount ?? item.pendingChapterCount,
          chapterSourceReadyCount: result.chaptersReady ?? item.chapterSourceReadyCount,
        } : item));
        setChapterProgress((current) => ({
          ...current,
          [resource.id]: {
            state: result.status === "completed" ? "completed" : "building",
            phase: result.status === "completed" ? "saving" : "pages",
            completedTopics: result.pagesDone ?? 0,
            totalTopics: result.totalPages ?? 0,
            foundQuestions: result.chaptersReady ?? 0,
            pageCoverage: result.pageCoverage,
          },
        }));
        if (result.message) setNotice(result.message);
        if (result.status === "extracting") continue;
        const refreshed = await fetch("/api/resources", { cache: "no-store" });
        if (refreshed.ok) {
          const data = (await readJson(refreshed)) as { resources?: LearningResource[] };
          setResources(data.resources ?? []);
        }
        await openChapterViewer(resource);
        return;
      }
      setNotice("本次已保存目前頁面；再次按下即可從最後成功頁接續。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "逐頁拆解失敗");
    } finally {
      chapterBuildRunningRef.current.delete(resource.id);
      setChapterSourceRunning(null);
    }
  }

  async function openChapterViewer(resource: LearningResource) {
    if (!resource.documentId) {
      setNotice("請先替這本書綁定教材文件，才能查看拆解內容。");
      return;
    }
    setChapterViewerLoading(resource.id);
    try {
      const response = await fetch(`/api/resources/chapters?resourceId=${resource.id}`, { cache: "no-store" });
      const result = (await readJson(response)) as {
        chapters?: ChapterSegment[];
        status?: string;
        message?: string;
        incompleteCount?: number;
        sourceFailures?: Array<{ segmentId: number; title: string; error: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "章節內容讀取失敗");
      const rows = Array.isArray(result.chapters) ? result.chapters : [];
      setChapterViewer({
        resource,
        rows,
        status: result.status,
        message: result.message,
        incompleteCount: result.incompleteCount,
        sourceFailures: result.sourceFailures,
      });
      setSelectedChapterId(rows[0]?.id ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "章節內容讀取失敗");
    } finally {
      setChapterViewerLoading(null);
    }
  }

  async function enrichBookText(resource: LearningResource) {
    if (!resource.documentId) {
      setNotice("請先替這本書綁定已完成索引的教材文件。");
      return;
    }
    if (chapterBuildRunningRef.current.has(resource.id)) return;
    chapterBuildRunningRef.current.add(resource.id);
    setChapterSourceRunning(resource.id);
    try {
      setNotice(`正在直接讀取「${resource.title}」的原始教材；進度會逐批保存，可中斷後接續。`);
      let pausedRetries = 0;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const response = await fetch("/api/resources/chapters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resourceId: resource.id,
            sourceBatch: true,
            restartSourceFailures: attempt === 0,
          }),
        });
        const result = (await readJson(response)) as {
          status?: "extracting" | "searching" | "paused" | "completed" | "partial";
          phase?: string;
          pagesDone?: number;
          totalPages?: number;
          chaptersReady?: number;
          chaptersTotal?: number;
          failedCount?: number;
          currentTitle?: string;
          message?: string;
          failures?: Array<{ title: string; error: string }>;
          error?: string;
        };
        if (!response.ok && response.status !== 202) throw new Error(result.error ?? "章節原文補齊失敗");
        if (result.status === "paused") {
          pausedRetries += 1;
          if (pausedRetries > 6) {
            setNotice(result.message ?? "原文索引目前較忙；進度已保存，稍後可按同一按鈕接續。");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(8000, 1200 * 2 ** pausedRetries)));
          continue;
        }
        pausedRetries = 0;
        setResources((current) => current.map((item) => item.id === resource.id ? {
          ...item,
          chapterCount: result.chaptersTotal ?? item.chapterCount,
          chapterSourceReadyCount: result.chaptersReady ?? item.chapterSourceReadyCount,
          sourcePageCount: result.pagesDone ?? item.sourcePageCount,
        } : item));
        if (result.message) setNotice(result.message);
        if (result.status === "extracting" || result.status === "searching") continue;
        if (result.status === "partial") {
          const examples = (result.failures ?? []).slice(0, 3).map((item) => item.title).join("、");
          setNotice(`「${resource.title}」已補齊 ${result.chaptersReady ?? 0}／${result.chaptersTotal ?? 0} 章原文；${result.failedCount ?? 0} 章未命中${examples ? `（${examples}${(result.failedCount ?? 0) > 3 ? "…" : ""}）` : ""}。未命中章節不會用假資料補寫。`);
        } else {
          setNotice(`「${resource.title}」已完成，共補齊 ${result.chaptersReady ?? result.chaptersTotal ?? 0} 章原文。`);
        }
        const refreshed = await fetch("/api/resources", { cache: "no-store" });
        if (refreshed.ok) {
          const refreshedResult = (await readJson(refreshed)) as { resources?: LearningResource[] };
          setResources(refreshedResult.resources ?? []);
        }
        await openChapterViewer(resource);
        return;
      }
      setNotice("本次處理時間較長，已保存目前進度；再次按下「補齊章節原文」會接續處理。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "章節原文補齊失敗");
    } finally {
      chapterBuildRunningRef.current.delete(resource.id);
      setChapterSourceRunning(null);
    }
  }

  async function startAutomaticChapterIndex(resource: LearningResource) {
    if (
      !resource.documentId ||
      resource.documentStatus !== "completed" ||
      !isProblemSolvingResource(resource) ||
      chapterJobsRef.current.has(resource.id) ||
      chapterProgressRef.current[resource.id]?.state === "completed"
    ) return;
    chapterJobsRef.current.add(resource.id);
    try {
      await buildBookChapters(resource);
    } finally {
      chapterJobsRef.current.delete(resource.id);
    }
  }

  useEffect(() => {
    chapterProgressRef.current = chapterProgress;
  }, [chapterProgress]);

  async function bindCourseBook(
    resource: LearningResource,
    linkedBookId: string,
  ) {
    const response = await fetch("/api/resources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...resource, linkedBookId: linkedBookId || null }),
    });
    const result = (await readJson(response)) as {
      resource?: LearningResource;
      error?: string;
    };
    if (!response.ok || !result.resource) {
      setNotice(result.error ?? "課程綁定書籍失敗");
      return;
    }
    setResources((current) =>
      current.map((item) =>
        item.id === resource.id
          ? { ...item, linkedBookId: result.resource!.linkedBookId }
          : item,
      ),
    );
    const book = resources.find((item) => item.id === Number(linkedBookId));
    setNotice(
      linkedBookId
        ? `${resource.title} 已綁定「${book?.title ?? "指定書籍"}」。`
        : `${resource.title} 已解除書籍綁定。`,
    );
  }

  async function removeExamSource(source: ExamSource) {
    if (
      !window.confirm(
        `確定刪除來源「${source.label}」？處理清單會移除，已發布真題會保留。`,
      )
    )
      return;
    const response = await fetch(`/api/exam-sources?id=${source.id}`, {
      method: "DELETE",
    });
    const result = await readJson(response);
    if (!response.ok) {
      setNotice(String(result.error || "來源刪除失敗"));
      return;
    }
    setExamSources((current) =>
      current.filter((item) => item.id !== source.id),
    );
    setNotice("考題來源網址已刪除；已發布題目仍保留在真題庫。");
  }

  function editResource(resource: LearningResource) {
    setResourceEditorDraft({
      id: resource.id,
      resourceType: resource.resourceType,
      title: resource.title,
      subject: resource.subject,
      creator: resource.creator,
      description: resource.description,
      sourceUrl: resource.sourceUrl,
      status: resource.status,
    });
  }

  async function saveResourceEditor() {
    if (!resourceEditorDraft?.title.trim()) {
      setNotice("資源名稱不能留白。");
      return;
    }
    const response = await fetch("/api/resources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resourceEditorDraft),
    });
    const result = (await readJson(response)) as {
      resource?: LearningResource;
      error?: string;
    };
    if (!response.ok || !result.resource) {
      setNotice(result.error ?? "資源編輯失敗");
      return;
    }
    setResources((current) =>
      current.map((item) =>
        item.id === resourceEditorDraft.id ? { ...item, ...result.resource } : item,
      ),
    );
    setResourceEditorDraft(null);
    setNotice("資源資料已更新。");
  }

  async function editMagazineIssue(
    resourceId: number,
    article: NonNullable<LearningResource["articlePreviews"]>[number],
  ) {
    const analysis = parseMagazineAnalysis(article.summary);
    setMagazineIssueEditorDraft({ resourceId, articleId: article.id, title: article.title, summary: analysis.summary, issue: analysis.issue });
  }

  async function saveMagazineIssueEditor() {
    if (!magazineIssueEditorDraft?.issue.trim()) {
      setNotice("核心爭點不能留白。");
      return;
    }
    const response = await fetch("/api/resources/segments", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: magazineIssueEditorDraft.articleId,
        summary: formatMagazineAnalysis(magazineIssueEditorDraft.summary, magazineIssueEditorDraft.issue.trim()),
        reviewStatus: "ai_reviewed",
        importance: 5,
        recommended: true,
      }),
    });
    const result = (await readJson(response)) as {
      segment?: { summary: string };
      error?: string;
    };
    if (!response.ok || !result.segment) {
      setNotice(result.error ?? "主要爭點更新失敗");
      return;
    }
    setResources((current) =>
      current.map((resource) =>
        resource.id !== magazineIssueEditorDraft.resourceId
          ? resource
          : {
              ...resource,
              articlePreviews: resource.articlePreviews?.map((item) =>
                item.id === magazineIssueEditorDraft.articleId
                  ? {
                      ...item,
                      summary: result.segment?.summary ?? formatMagazineAnalysis(magazineIssueEditorDraft.summary, magazineIssueEditorDraft.issue.trim()),
                      reviewStatus: "ai_reviewed",
                      analysisState: "analyzed",
                    }
                  : item,
              ),
            },
      ),
    );
    setMagazineIssueEditorDraft(null);
    setNotice("核心爭點已更新，摘要會保留，前台與 AI 帶入會使用這段內容。");
  }

  async function removeResource(resource: LearningResource) {
    if (
      !window.confirm(
        `確定移除「${resource.title}」？相關字幕片段與書封也會刪除。`,
      )
    )
      return;
    const response = await fetch(`/api/resources?id=${resource.id}`, {
      method: "DELETE",
    });
    const result = (await readJson(response)) as { error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "資源移除失敗");
      return;
    }
    setResources((current) =>
      current.filter((item) => item.id !== resource.id),
    );
    setNotice(`${resource.title} 已移除。`);
  }

  function orderedResourceGroup(resourceType: string) {
    return resources
      .filter((item) => item.resourceType === resourceType)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
  }

  async function moveResource(resource: LearningResource, direction: -1 | 1) {
    const group = orderedResourceGroup(resource.resourceType);
    const index = group.findIndex((item) => item.id === resource.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= group.length) return;
    const reordered = [...group];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const orderById = new Map(reordered.map((item, itemIndex) => [item.id, itemIndex]));
    setResources((current) => current.map((item) => orderById.has(item.id) ? { ...item, sortOrder: orderById.get(item.id) ?? item.sortOrder } : item));
    const responses = await Promise.all(reordered.map((item, itemIndex) => fetch("/api/resources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, sortOrder: itemIndex }),
    })));
    if (responses.some((response) => !response.ok)) {
      setNotice("課程／書本順序儲存失敗，請重新整理後再試。");
      return;
    }
    setNotice(`${resource.resourceType === "course" ? "影音課程" : "書本"}順序已更新。`);
  }

  async function openSubtitleEditor(resource: LearningResource) {
    const response = await fetch(
      `/api/resources/segments?resourceId=${resource.id}`,
    );
    const result = (await response.json()) as { segments?: SubtitleSegment[] };
    setSubtitleCourse(resource);
    setSubtitleSegments(result.segments ?? []);
    setSegmentPage(1);
    setCoursePreviewTime(0);
  }

  async function openCoursePreview(resource: LearningResource) {
    setCoursePreviewResource(resource);
    setCoursePreviewSegments([]);
    setCoursePreviewError("");
    setCoursePreviewTime(0);
    setCoursePreviewLoading(true);
    try {
      const response = await fetch(`/api/resources/segments?resourceId=${resource.id}&view=summary`);
      const result = (await readJson(response)) as { segments?: SubtitleSegment[]; error?: string };
      if (!response.ok) {
        setCoursePreviewError(result.error ?? "無法讀取課程重點");
        return;
      }
      setCoursePreviewSegments(result.segments ?? []);
    } catch {
      setCoursePreviewError("無法讀取課程重點，請稍後再試。");
    } finally {
      setCoursePreviewLoading(false);
    }
  }

  function youtubeEmbedUrl(value: string, startSeconds = 0) {
    try {
      const url = new URL(value.trim());
      let id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? "");
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

  function directVideoUrl(value: string) {
    return /\.(?:mp4|webm|ogg|m4v|m3u8)(?:[?#].*)?$/i.test(value.trim());
  }

  function seekCoursePreview(seconds: number) {
    const next = Math.max(0, Math.floor(seconds));
    setCoursePreviewTime(next);
    setCoursePreviewSeekToken((token) => token + 1);
  }

  async function saveSegment(segment: SubtitleSegment) {
    const response = await fetch("/api/resources/segments", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...segment, reviewStatus: "reviewed" }),
    });
    const result = (await response.json()) as { segment?: SubtitleSegment };
    if (result.segment)
      setSubtitleSegments((current) =>
        current.map((item) =>
          item.id === segment.id ? result.segment! : item,
        ),
      );
  }

  async function analyzeCourseSegments() {
    if (!subtitleCourse) return;
    setAnalyzingSegments(true);
    const response = await fetch("/api/resources/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId: subtitleCourse.id, action: "digest" }),
    });
    const result = (await readJson(response)) as {
      analyzed?: number;
      digestCount?: number;
      error?: string;
    };
    if (!response.ok) setNotice(result.error ?? "AI 重點分析失敗");
    else {
      setNotice(`AI 已整理 ${result.digestCount ?? result.analyzed ?? 0} 個摘要重點；原始字幕仍保留在後台。`);
      await openSubtitleEditor(subtitleCourse);
    }
    setAnalyzingSegments(false);
  }

  async function addExamSource(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/exam-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: sourceUrl,
        label: sourceLabel,
        examType: sourceExamType,
        sourceKind,
      }),
    });
    const result = (await readJson(response)) as {
      source?: ExamSource;
      error?: string;
    };
    if (!response.ok || !result.source) {
      setNotice(result.error ?? "無法儲存真題來源");
      return;
    }
    setExamSources((current) => [result.source!, ...current]);
    setSourceUrl("");
    setSourceLabel("");
    setNotice(
      "真題來源已加入等待清單；下載、拆題及人工確認功能會依來源規則接續處理。",
    );
  }

  async function runExamSourceStep(sourceId: number, rescan = false) {
    setExamSources((current) =>
      current.map((source) =>
        source.id === sourceId
          ? { ...source, status: "extracting", lastError: null }
          : source,
      ),
    );
    const response = await fetch("/api/exam-sources/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, rescan }),
    });
    const result = (await readJson(response)) as ExamProcessResult;
    if (!response.ok) throw new Error(result.error ?? "真題處理失敗");
    setExamSources((current) =>
      current.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              status: result.status ?? "waiting",
              processedCount: result.processedCount ?? source.processedCount,
              discoveredCount: result.discoveredCount ?? source.discoveredCount,
              questionCount: result.questionCount ?? source.questionCount,
              lastError: null,
            }
          : source,
      ),
    );
    return result;
  }

  async function processExamSource(sourceId: number) {
    setProcessingSourceId(sourceId);
    setNotice("正在讀取來源、下載下一份 PDF 並拆解題目；請勿關閉頁面…");
    try {
      const result = await runExamSourceStep(sourceId);
      setNotice(
        `${result.message ?? "真題處理完成"}。若仍有待處理 PDF，可再次按「處理下一份」。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "真題處理失敗";
      setExamSources((current) =>
        current.map((source) =>
          source.id === sourceId
            ? { ...source, status: "failed", lastError: message }
            : source,
        ),
      );
      setNotice(message);
    } finally {
      setProcessingSourceId(null);
    }
  }

  async function rescanExamSource(sourceId: number) {
    setProcessingSourceId(sourceId);
    setNotice("正在重新掃描高點完整題庫，並補入尚未發現的司律二試 PDF…");
    try {
      const result = await runExamSourceStep(sourceId, true);
      setNotice(`${result.message ?? "重新掃描完成"}；已更新來源總數，可繼續批次處理。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重新掃描失敗");
    } finally {
      setProcessingSourceId(null);
    }
  }

  async function processAllExamSource(sourceId: number) {
    batchStopRef.current = false;
    setBatchSourceId(sourceId);
    setProcessingSourceId(sourceId);
    setNotice(
      "批次處理已開始，會逐份下載與拆題；請保持此頁開啟。完成目前這份後可安全停止。",
    );
    try {
      while (!batchStopRef.current) {
        const result = await runExamSourceStep(sourceId);
        const processed = result.processedCount ?? 0;
        const discovered = result.discoveredCount ?? 0;
        setNotice(
          `${result.message ?? "已完成一份"}；總進度 ${processed} / ${discovered} 份，累計 ${result.questionCount ?? 0} 題。`,
        );
        if (
          result.status === "review" ||
          (discovered > 0 && processed >= discovered)
        )
          break;
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (batchStopRef.current)
        setNotice(
          "批次處理已停止；目前進度已保存，下次可從未完成的 PDF 繼續。",
        );
      else setNotice("此來源的全部 PDF 已完成拆題，題目已進入待人工確認。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "批次處理失敗";
      setExamSources((current) =>
        current.map((source) =>
          source.id === sourceId
            ? { ...source, status: "failed", lastError: message }
            : source,
        ),
      );
      setNotice(`${message}；進度已保存，可按重試繼續。`);
    } finally {
      setBatchSourceId(null);
      setProcessingSourceId(null);
      batchStopRef.current = false;
    }
  }

  async function toggleFrontendCosts() {
    if (!usage) return;
    const next = !usage.showCosts;
    const response = await fetch("/api/usage", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showCosts: next }),
    });
    if (response.ok) {
      setUsage({ ...usage, showCosts: next });
      window.dispatchEvent(new CustomEvent("frontend-costs-change", { detail: next }));
    }
  }

  async function toggleTeachingEvidence() {
    if (!usage) return;
    const next = !usage.showEvidence;
    const response = await fetch("/api/usage", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ showEvidence: next }) });
    if (response.ok) setUsage({ ...usage, showEvidence: next });
  }

  async function toggleEssayGradingDual() {
    if (!usage) return;
    const next = !usage.essayGradingDualEnabled;
    const response = await fetch("/api/usage", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ essayGradingDualEnabled: next }) });
    if (response.ok) setUsage({ ...usage, essayGradingDualEnabled: next });
  }

  async function testGlmConnection() {
    setGlmTesting(true);
    setGlmTestResult(null);
    try {
      const response = await fetch("/api/model-test/glm", { method: "POST" });
      const payload = await response.json() as typeof glmTestResult;
      setGlmTestResult(response.ok ? payload : { error: payload?.error || "GLM 測試失敗" });
    } catch {
      setGlmTestResult({ error: "目前無法執行 GLM 測試，請稍後再試。" });
    } finally {
      setGlmTesting(false);
    }
  }

  async function processDocument(documentId: number, retry = false) {
    setFiles((current) =>
      current.map((item) =>
        item.id === documentId
          ? { ...item, status: "processing", processingStage: retry ? "queued" : item.processingStage, error: null }
          : item,
      ),
    );
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await fetch("/api/documents/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentId, retry: retry && attempt === 0 }),
        });
        const result = (await readJson(response)) as { status?: string; stage?: string; message?: string; error?: string; document?: Uploaded };
        if (!response.ok && response.status !== 202) throw new Error(result.error ?? "教材自動處理失敗");
        setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: result.status ?? "processing", processingStage: result.stage ?? item.processingStage, processingMessage: result.message ?? item.processingMessage } : item));
        setNotice(result.message ?? "教材正在自動處理…");
        if (result.status === "completed") {
          const refreshed = await fetch("/api/documents", { cache: "no-store" });
          if (refreshed.ok) {
            const data = await refreshed.json() as { documents?: Array<Record<string, unknown>>; stats?: DocumentStats };
            const current = (data.documents ?? []).find((item) => Number(item.id) === documentId);
            if (current) setFiles((items) => items.map((item) => item.id === documentId ? { ...item, bookTitle: typeof current.bookTitle === "string" && current.bookTitle.trim() ? current.bookTitle : item.bookTitle, status: String(current.status ?? "completed"), processingStage: String(current.processingStage ?? "completed"), processingMessage: String(current.processingMessage ?? "教材自動處理完成"), pageCount: Number(current.pageCount ?? 0) || null, extractedChars: Number(current.extractedChars ?? 0), chapterCount: Number(current.chapterCount ?? 0), topicCount: Number(current.topicCount ?? 0), questionCount: Number(current.questionCount ?? 0), tags: Array.isArray(current.tags) ? current.tags.map(String) : [], fullTextIndexed: Boolean(current.fullTextIndexed), vectorIndexed: Boolean(current.vectorIndexed), error: typeof current.error === "string" ? current.error : null } : item));
            if (data.stats) setDocumentStats(data.stats);
            const resourcesResponse = await fetch("/api/resources", { cache: "no-store" });
            if (resourcesResponse.ok) {
              const loaded = ((await resourcesResponse.json()) as { resources?: LearningResource[] }).resources ?? [];
              setResources(loaded);
              void refreshChapterProgress(loaded.filter((item) => item.resourceType === "book").map((item) => item.id));
            }
          }
          return true;
        }
        if (result.status === "failed") throw new Error(result.error ?? "教材自動處理失敗");
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      throw new Error("教材處理時間較長，進度已保存；稍後會自動接續");
    } catch (error) {
      const message = error instanceof Error ? error.message : "建立索引失敗";
      setFiles((current) =>
        current.map((item) =>
          item.id === documentId
            ? { ...item, status: "failed", processingStage: "failed", processingMessage: message, error: message }
            : item,
        ),
      );
      setNotice(message);
      return false;
    }
  }

  async function startIndex(documentId: number) {
    await processDocument(documentId, true);
  }

  async function toggleHomepageDocument(file: Uploaded) {
    const next = !file.homepageSearchEnabled;
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, homepageSearchEnabled: next } : item));
    setNotice(next ? `正在開放「${file.name}」供首頁搜尋…` : `正在停止首頁搜尋「${file.name}」…`);
    try {
      let response = await fetch("/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: file.id, homepageSearchEnabled: next }) });
      let result = await response.json() as { error?: string; code?: string; repairable?: boolean };
      if (!response.ok && next && response.status === 409 && result.code === "INDEX_REPAIR_REQUIRED" && result.repairable) {
        setNotice(`「${file.name}」是舊版索引，正在自動補建；完成後會直接開放首頁搜尋…`);
        const repaired = await processDocument(file.id, true);
        if (!repaired) throw new Error("舊版索引補建失敗，請查看這份教材的處理訊息");
        response = await fetch("/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: file.id, homepageSearchEnabled: next }) });
        result = await response.json() as { error?: string; code?: string; repairable?: boolean };
      }
      if (!response.ok) throw new Error(result.error ?? "首頁搜尋設定更新失敗");
      setNotice(next ? `「${file.name}」已允許首頁 AI 搜尋；不必開啟或綁定智能書。` : `「${file.name}」已停止供首頁 AI 搜尋；智能書綁定不受影響。`);
    } catch (error) {
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, homepageSearchEnabled: !next } : item));
      setNotice(error instanceof Error ? error.message : "首頁搜尋設定更新失敗");
    }
  }

  async function saveDocumentBookTitle(file: Uploaded) {
    const bookTitle = normalizeDocumentTitle(file.bookTitle ?? "") || documentDisplayTitle(null, file.name);
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, bookTitle } : item));
    const response = await fetch("/api/documents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: file.id, bookTitle }),
    });
    const result = await response.json() as { bookTitle?: string; error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "教材顯示名稱儲存失敗");
      return;
    }
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, bookTitle: result.bookTitle ?? bookTitle } : item));
    setNotice(`前台教材名稱已更新為「${result.bookTitle ?? bookTitle}」。`);
  }

  async function testDocumentSearch(file: Uploaded) {
    const query = (documentSearchQueries[file.id] ?? "").trim();
    if (query.length < 2) {
      setNotice("請先輸入至少兩個字的教材測試關鍵字，例如「未遂」或「第三章」。");
      return;
    }
    setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "testing", query } }));
    try {
      const response = await fetch("/api/documents/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: file.id, query }),
      });
      const result = await response.json() as DocumentSearchTest & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "教材向量索引測試失敗");
      setDocumentSearchTests((current) => ({
        ...current,
        [file.id]: {
          status: "success",
          query,
          selectedFileWasSearched: Boolean(result.selectedFileWasSearched),
          hits: result.hits ?? [],
        },
      }));
      setNotice(result.selectedFileWasSearched ? `「${file.name}」已命中 ${result.hits?.length ?? 0} 個教材片段。` : `「${file.name}」這次沒有命中指定檔案片段。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "教材向量索引測試失敗";
      setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "error", query, error: message } }));
      setNotice(message);
    }
  }

  async function autoTestDocumentSearch(file: Uploaded) {
    const metadataCandidates = [...new Set([
      ...(file.tags ?? []),
      ...(file.chapters ?? []).flatMap((chapter) => [chapter.title, chapter.path]),
      ...(file.questions ?? []).map((question) => question.title),
      file.subject,
    ].map((value) => String(value ?? "").replace(/^(?:第.{1,10}[章節篇]|\d+(?:\.\d+)*[、.\s]*)/u, "").trim()).filter((value) => value.length >= 2))];
    let aiCandidates: string[] = [];
    try {
      const candidateResponse = await fetch("/api/documents/search-test-candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: file.id }) });
      const candidateResult = await candidateResponse.json() as { queries?: string[] };
      if (candidateResponse.ok) aiCandidates = candidateResult.queries ?? [];
    } catch { /* metadata fallback below */ }
    const candidates = [...new Set([...aiCandidates, ...metadataCandidates])].slice(0, 10);
    if (!candidates.length) {
      setNotice("這份教材尚未產生可用的章節或標籤，請先完成 AI 結構分析。");
      return;
    }
    setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "testing", query: `AI 自動模擬測試 0 / ${candidates.length}`, autoResults: [] } }));
    const results: NonNullable<DocumentSearchTest["autoResults"]> = [];
    try {
      for (const query of candidates) {
        const response = await fetch("/api/documents/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: file.id, query }) });
        const result = await response.json() as DocumentSearchTest & { error?: string };
        if (!response.ok) {
          results.push({ query, hit: false, hits: 0, page: null, excerpt: result.error ?? "測試失敗" });
          setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "testing", query: `AI 自動模擬測試 ${results.length} / ${candidates.length}`, autoResults: [...results] } }));
          continue;
        }
        const first = result.hits?.find((item) => item.evidenceMatched) ?? result.hits?.[0];
        const verified = Boolean(result.evidenceVerified && first?.evidenceMatched);
        results.push({
          query,
          hit: verified,
          hits: result.hits?.filter((item) => item.evidenceMatched).length ?? 0,
          page: first?.pageStart ?? null,
          excerpt: first?.text?.slice(0, 260) ?? "",
          title: (first as { title?: string } | undefined)?.title,
          retrievalMode: (first as { retrievalMode?: string } | undefined)?.retrievalMode,
          reason: verified ? "測試詞可在顯示原文中直接核對" : "只有語意相近片段，未找到可直接核對的測試詞",
        });
        setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "testing", query: `AI 自動模擬測試 ${results.length} / ${candidates.length}`, autoResults: [...results] } }));
      }
      const passed = results.filter((item) => item.hit).length;
      setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "success", query: "AI 自動模擬測試", selectedFileWasSearched: passed > 0, autoResults: results } }));
      const savedResponse = await fetch("/api/documents/search-tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: file.id, documentName: file.bookTitle || file.name, results }) });
      const saved = await savedResponse.json() as { run?: DocumentSearchRun };
      if (saved.run) setDocumentSearchHistory((current) => ({ ...current, [file.id]: [saved.run!, ...(current[file.id] ?? [])].slice(0, 10) }));
      setNotice(`「${file.bookTitle || file.name}」自動測試完成：${passed} / ${results.length} 組查詢命中。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 自動模擬測試失敗";
      setDocumentSearchTests((current) => ({ ...current, [file.id]: { status: "error", query: "AI 自動模擬測試", error: message, autoResults: results } }));
      setNotice(message);
    }
  }

  async function loadDocumentSearchHistory(documentId: number) {
    const response = await fetch(`/api/documents/search-tests?documentId=${documentId}`, { cache: "no-store" });
    const data = await response.json() as { runs?: DocumentSearchRun[] };
    if (response.ok) setDocumentSearchHistory((current) => ({ ...current, [documentId]: data.runs ?? [] }));
  }

  async function buildFineSearchIndex(file: Uploaded) {
    if (fineIndexingDocumentId) return;
    setFineIndexingDocumentId(file.id);
    setNotice(`正在檢查「${file.bookTitle || file.name}」的精準搜尋片段，會從上次完成頁面接續…`);
    try {
      let restart = true;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const response = await fetch("/api/documents/fine-index", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentId: file.id, restart }),
        });
        const result = await response.json() as { done?: boolean; pagesDone?: number; totalPages?: number; units?: number; error?: string };
        if (!response.ok) throw new Error(result.error ?? "精準搜尋索引建立失敗");
        restart = false;
        setFiles((current) => current.map((item) => item.id === file.id ? { ...item, fineSearchUnitCount: Number(result.units ?? 0) } : item));
        setNotice(`精準索引進度：${result.pagesDone ?? 0} / ${result.totalPages ?? 0} 頁，已建立 ${result.units ?? 0} 個搜尋片段。`);
        if (result.done) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      setNotice(`「${file.bookTitle || file.name}」已完成並保存頁面級精準索引；重新整理後仍會保留。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "精準搜尋索引建立失敗");
    } finally {
      setFineIndexingDocumentId(null);
    }
  }

  async function toggleDocumentAssignment(file: Uploaded, category: "law" | "pengli" | "medtech" | "accounting") {
    try {
      const response = await fetch(`/api/documents/assignments?documentId=${file.id}`, { cache: "no-store" });
      const loaded = await response.json() as { assignments?: Array<{ examCategory: string; subject: string; usageType?: string; visibility?: string; aiSearchEnabled?: boolean }>; error?: string };
      if (!response.ok) throw new Error(loaded.error ?? "讀取教材平台失敗");
      const current = loaded.assignments ?? [];
      const exists = current.some((item) => item.examCategory === category);
      const next = exists
        ? current.filter((item) => item.examCategory !== category)
        : [...current, { examCategory: category, subject: category === "pengli" ? "行政法" : file.subject, usageType: "教材檢索", visibility: "members", aiSearchEnabled: true }];
      if (!next.length) throw new Error("至少保留一個使用平台");
      const savedResponse = await fetch("/api/documents/assignments", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: file.id, assignments: next }) });
      const saved = await savedResponse.json() as { assignments?: Array<{ examCategory: string }>; error?: string };
      if (!savedResponse.ok) throw new Error(saved.error ?? "教材平台儲存失敗");
      const assignmentCategories = (saved.assignments ?? []).map((item) => item.examCategory);
      let normalizedBookTitle = file.bookTitle;
      let normalizedTags = file.tags;
      if (category === "pengli" && !exists && /彭狸|行政法考點/u.test(`${file.bookTitle ?? ""} ${file.name}`)) {
        normalizedBookTitle = "行政法考點演習書（二版）｜彭狸";
        normalizedTags = ["法律", "行政法", "核心教材", "彭狸老師"];
        const metadataResponse = await fetch("/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: file.id, bookTitle: normalizedBookTitle, tags: normalizedTags }) });
        const metadata = await metadataResponse.json() as { error?: string };
        if (!metadataResponse.ok) throw new Error(metadata.error ?? "彭狸教材名稱與標籤更新失敗");
      }
      setFiles((rows) => rows.map((item) => item.id === file.id ? { ...item, bookTitle: normalizedBookTitle, tags: normalizedTags, subject: category === "pengli" && !exists ? "行政法" : item.subject, assignmentCategories, assignmentCount: assignmentCategories.length } : item));
      setNotice(`「${file.bookTitle || file.name}」的平台關聯已更新。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "教材平台儲存失敗");
    }
  }

  async function deleteSelectedDocuments() {
    if (!selectedDocumentIds.length || deletingDocuments) return;
    if (!window.confirm(`確定刪除已選取的 ${selectedDocumentIds.length} 份教材？\n\n原始檔、全文／向量索引及處理紀錄都會一併刪除；已綁定的智能書會解除教材連結。`)) return;
    setDeletingDocuments(true);
    setNotice(`正在刪除 ${selectedDocumentIds.length} 份教材及其索引…`);
    try {
      const response = await fetch("/api/documents", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedDocumentIds }) });
      const result = await response.json() as { deleted?: number; deletedIds?: number[]; deletedReady?: number; deletedIndexedBytes?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "教材刪除失敗");
      const deletedIds = new Set(result.deletedIds ?? []);
      setFiles((current) => current.filter((file) => !deletedIds.has(file.id)));
      setSelectedDocumentIds([]);
      setDocumentStats((current) => ({
        ...current,
        total: Math.max(0, current.total - (result.deleted ?? 0)),
        ready: Math.max(0, current.ready - (result.deletedReady ?? 0)),
        indexedBytes: Math.max(0, current.indexedBytes - (result.deletedIndexedBytes ?? 0)),
      }));
      setDocumentPage(1);
      setNotice(`已刪除 ${result.deleted ?? 0} 份教材、原始檔與搜尋索引。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "教材刪除失敗");
    } finally {
      setDeletingDocuments(false);
    }
  }

  function chooseFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    const documents = incoming.filter((file) => /\.(pdf|jsonl|md|txt|docx|zip)$/i.test(file.name));
    const rejected = incoming.length - documents.length;
    setQueue((current) => {
      const known = new Set(
        current.map(
          (item) =>
            `${item.file.name}-${item.file.size}-${item.file.lastModified}`,
        ),
      );
      const additions = documents
        .filter(
          (file) =>
            !known.has(`${file.name}-${file.size}-${file.lastModified}`),
        )
        .map((file, index) => ({
          key: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
          file,
          status: "queued" as const,
          progress: 0,
        }));
      return [...current, ...additions];
    });
    setNotice(
      documents.length
        ? `已加入 ${documents.length} 份教材（PDF／JSONL／MD／TXT／DOCX／ZIP）${rejected ? `，另排除 ${rejected} 個不支援檔案` : ""}。確認科目與類型後即可自動處理。`
        : "拖入的檔案不是 PDF、JSONL、MD、TXT、DOCX 或 ZIP，請重新選擇。",
    );
  }

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function uploadOne(item: QueueItem, position: number, total: number) {
    const selected = item.file;
    const documentContentType = selected.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : selected.name.toLowerCase().endsWith(".jsonl")
        ? "application/jsonl"
        : selected.name.toLowerCase().endsWith(".md")
          ? "text/markdown"
          : selected.name.toLowerCase().endsWith(".docx")
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : selected.name.toLowerCase().endsWith(".zip")
          ? "application/zip"
          : "text/plain";
    patchQueue(item.key, {
      status: "uploading",
      progress: 0,
      error: undefined,
    });
    setNotice(`正在處理第 ${position}／${total} 本：${selected.name}`);

    const initResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "init",
          fileName: selected.name,
          contentType: documentContentType,
      }),
    });
    const init = (await readJson(initResponse)) as {
      key?: string;
      uploadId?: string;
      error?: string;
    };
    if (!initResponse.ok || !init.key || !init.uploadId)
      throw new Error(init.error ?? "無法開始上傳");

    const chunkSize = 5 * 1024 * 1024;
    const totalParts = Math.ceil(selected.size / chunkSize);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (
      let start = 0, partNumber = 1;
      start < selected.size;
      start += chunkSize, partNumber += 1
    ) {
      const chunk = selected.slice(
        start,
        Math.min(start + chunkSize, selected.size),
      );
      const partResponse = await fetch(
        `/api/documents/multipart?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: chunk,
        },
      );
      const part = (await readJson(partResponse)) as {
        partNumber?: number;
        etag?: string;
        error?: string;
      };
      if (!partResponse.ok || !part.partNumber || !part.etag)
        throw new Error(part.error ?? `第 ${partNumber} 段上傳失敗`);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      patchQueue(item.key, {
        progress: Math.round((partNumber / totalParts) * 85),
      });
    }

    const completeResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        key: init.key,
        uploadId: init.uploadId,
        parts,
        fileName: selected.name,
        contentType: documentContentType,
        sizeBytes: selected.size,
        examCategory,
        subject,
        documentType: type,
      }),
    });
    const completed = (await readJson(completeResponse)) as {
      document?: { id: number };
      error?: string;
    };
    if (!completeResponse.ok || !completed.document?.id)
      throw new Error(completed.error ?? "無法完成文件上傳");
    const newId = completed.document.id;
    setFiles((current) => [
      {
        id: newId,
        name: selected.name,
        bookTitle: documentDisplayTitle(null, selected.name),
        examCategory,
        subject,
        size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${documentContentType}`,
        status: "processing",
        type: documentContentType,
        processingStage: "queued",
        processingMessage: "等待自動處理",
      },
      ...current,
    ]);
    setDocumentPage(1);
    patchQueue(item.key, { status: "indexing", progress: 92 });
    const processed = await processDocument(newId);
    if (!processed) throw new Error("教材自動處理失敗，請查看文件卡片後重新處理");
    patchQueue(item.key, { status: "done", progress: 100 });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pending = queue.filter(
      (item) => item.status === "queued" || item.status === "failed",
    );
    if (!pending.length) return;
    setUploading(true);
    setNotice("");
    let failed = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      try {
        await uploadOne(item, index + 1, pending.length);
      } catch (error) {
        failed += 1;
        patchQueue(item.key, {
          status: "failed",
          error: error instanceof Error ? error.message : "文件上傳失敗",
        });
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    setNotice(
      failed
        ? `批次處理完成：${pending.length - failed} 本成功，${failed} 本失敗，可按下方按鈕重試失敗項目。`
        : `${pending.length} 本 PDF 已依序上傳，索引服務正在處理。`,
    );
    if (!failed && libraryMode) setLibrarySection("materials");
  }

  const normalizedLibrarySearch = librarySearch.trim().toLowerCase();
  const categoryFiles = files.filter((file) => !normalizedLibrarySearch || `${file.bookTitle ?? ""} ${file.name} ${file.subject} ${file.type ?? ""} ${(file.tags ?? []).join(" ")}`.toLowerCase().includes(normalizedLibrarySearch));
  const documentPageCount = Math.max(
    1,
    Math.ceil(categoryFiles.length / DOCUMENTS_PER_PAGE),
  );
  const visibleFiles = categoryFiles.slice(
    (documentPage - 1) * DOCUMENTS_PER_PAGE,
    documentPage * DOCUMENTS_PER_PAGE,
  );
  const usagePageCount = Math.max(
    1,
    Math.ceil((usage?.recent.length ?? 0) / USAGE_PER_PAGE),
  );
  const visibleUsage =
    usage?.recent.slice(
      (usagePage - 1) * USAGE_PER_PAGE,
      usagePage * USAGE_PER_PAGE,
    ) ?? [];
  const activeChapter = chapterViewer?.rows.find((chapter) => chapter.id === selectedChapterId)
    ?? chapterViewer?.rows[0]
    ?? null;
  const questionBankDocumentSubjects = [...new Set((questionBankSummary?.files ?? []).map((file) => file.subject).filter(Boolean))].sort();
  const questionBankDocumentTypes = [...new Set((questionBankSummary?.files ?? []).map((file) => file.documentType).filter(Boolean))].sort();
  const filteredQuestionBankFiles = (questionBankSummary?.files ?? []).filter((file) => {
    if (questionBankCategory !== "all" && file.examCategory !== questionBankCategory) return false;
    if (questionBankDocumentSubject && file.subject !== questionBankDocumentSubject) return false;
    if (questionBankDocumentType && file.documentType !== questionBankDocumentType) return false;
    if (questionBankDocumentStatus && file.status !== questionBankDocumentStatus) return false;
    const query = questionBankDocumentQuery.trim().toLowerCase();
    return !query || `${file.bookTitle} ${file.fileName} ${file.subject} ${file.documentType}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    if (activeTab !== "members") return;
    setMembersLoading(true);
    fetch("/api/admin/members")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "無法讀取學員名單");
        setMembers(data.members ?? []);
        setMemberDeletionAudits(data.deletionAudits ?? []);
      })
      .catch((error) => setMemberNotice(error instanceof Error ? error.message : "無法讀取學員名單"))
      .finally(() => setMembersLoading(false));
  }, [activeTab]);

  async function loadQuestionBank() {
    setQuestionBankLoading(true);
    const params = new URLSearchParams();
    if (questionBankCategory !== "all") params.set("category", questionBankCategory);
    if (questionBankSubject) params.set("subject", questionBankSubject);
    if (questionBankYear) params.set("year", questionBankYear);
    if (questionBankExamType) params.set("examType", questionBankExamType);
    if (questionBankStatus) params.set("status", questionBankStatus);
    const combinedQuery = [questionBankQuery, questionBankChapter].filter(Boolean).join(" ");
    if (combinedQuery) params.set("query", combinedQuery);
    await fetch(`/api/admin/question-bank-summary?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as QuestionBankSummary & { error?: string };
        if (!response.ok) throw new Error(data.error || "無法讀取總題庫");
        setQuestionBankSummary(data);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "無法讀取總題庫"))
      .finally(() => setQuestionBankLoading(false));
  }

  useEffect(() => {
    if (activeTab !== "question-bank") return;
    const timer = window.setTimeout(() => void loadQuestionBank(), 150);
    return () => window.clearTimeout(timer);
  }, [activeTab, questionBankCategory, questionBankSubject, questionBankYear, questionBankExamType, questionBankStatus]);

  async function createQuestionPack() {
    setQuestionPackNotice("正在建立組合包…");
    const response = await fetch("/api/admin/question-bank-summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: questionPackName, examCategory: questionBankCategory, description: questionBankChapter ? `章節／主題：${questionBankChapter}` : "", questionIds: selectedQuestionBankIds }) });
    const data = await response.json() as { package?: QuestionBankSummary["packages"] extends Array<infer T> ? T : never; error?: string };
    if (!response.ok) { setQuestionPackNotice(data.error ?? "組合包建立失敗"); return; }
    setQuestionPackName("");
    setSelectedQuestionBankIds([]);
    setQuestionPackNotice(`已建立「${data.package?.name}」，共 ${data.package?.questionCount ?? 0} 題，保留為草稿。`);
    await loadQuestionBank();
  }

  async function addCentralPdfSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = centralPdfUrl.trim();
    if (!/^https:\/\/[^\s]+\.pdf(?:\?[^\s]*)?$/i.test(url)) {
      setQuestionPackNotice("請貼上完整的 HTTPS PDF 網址。");
      return;
    }
    setCentralPdfAdding(true);
    setQuestionPackNotice("正在加入 PDF 來源…");
    const response = await fetch("/api/exam-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, label: centralPdfLabel.trim() || url.split("/").pop()?.replace(/\.pdf(?:\?.*)?$/i, "") || "直接 PDF 匯入", examType: centralPdfExamType, sourceKind: "exam" }) });
    const data = await response.json() as { source?: { id: number }; error?: string };
    if (!response.ok || !data.source) {
      setQuestionPackNotice(data.error ?? "PDF 來源加入失敗");
      setCentralPdfAdding(false);
      return;
    }
    setQuestionPackNotice("PDF 來源已加入，正在直接辨識並建立題庫項目…");
    const processResponse = await fetch("/api/exam-sources/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: data.source.id }) });
    const processed = await processResponse.json() as { message?: string; error?: string };
    setQuestionPackNotice(processResponse.ok ? processed.message ?? "PDF 已完成拆題" : processed.error ?? "PDF 已加入，但拆題失敗");
    setCentralPdfLabel("");
    setCentralPdfUrl("");
    await loadQuestionBank();
    setCentralPdfAdding(false);
  }

  async function updateMember(id: number, patch: Partial<Pick<MemberRow, "role" | "canAdmin" | "status" | "className">> & { password?: string }) {
    setMemberNotice("儲存中…");
    const response = await fetch("/api/admin/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    const data = await response.json();
    if (!response.ok) { setMemberNotice(data.error || "儲存失敗"); return; }
    setMembers((rows) => rows.map((row) => row.id === id ? { ...row, ...data.member, ...(patch.password ? { passwordResetRequestedAt: null } : {}) } : row));
    setMemberNotice("學員設定已儲存");
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemberCreating(true);
    setMemberNotice("正在新增學員…");
    try {
      const response = await fetch("/api/admin/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newMember) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "新增學員失敗");
      setMembers((rows) => [data.member, ...rows]);
      setNewMember({ displayName: "", email: "", password: "", className: "", role: "student", status: "active" });
      setMemberNotice(`已新增學員：${data.member.displayName}`);
    } catch (error) {
      setMemberNotice(error instanceof Error ? error.message : "新增學員失敗");
    } finally {
      setMemberCreating(false);
    }
  }

  if (workspaceMode === "management") {
    return <main className="admin-route-forward"><span>正在進入中央教材庫…</span></main>;
  }

  return (
    <main className={`admin-shell ${independentMode ? "independent-admin-shell" : ""} ${libraryMode ? "library-admin-shell" : ""} ${questionBankMode ? "question-bank-admin-shell" : ""}`}>
      <header className="topbar">
        <a href="/platform" className="brand">
          <span className="brand-mark">智</span>
          <span>iBrain AI</span>
        </a>
        <a href={independentMode ? "/admin" : "/platform"} className="back-link">
          {independentMode ? "返回總管理後台 →" : "返回平台入口 →"}
        </a>
      </header>
      <div className="admin-main">
        <div className="admin-title">
          <div>
            <p>{libraryMode ? "CENTRAL KNOWLEDGE INFRASTRUCTURE" : questionBankMode ? "CENTRAL QUESTION BANK" : memberMode ? "CENTRAL MEMBER DIRECTORY" : "COMPANY MANAGEMENT CENTER"}</p>
            <h1>{libraryMode ? "中央教材向量資料庫" : questionBankMode ? "跨類科總題庫管理" : memberMode ? "全平台會員總管理" : "iBrain 總管理後台"}</h1>
            <span>{libraryMode ? "獨立處理公司教材的文字抽取、最小單位切片、全文索引、向量索引與檢索驗證。" : questionBankMode ? "以共用資料庫集中管理全部類科的文件題庫、網址題庫、拆題、校對、版本與發布狀態。" : memberMode ? "集中查看全部會員、所屬類科、班級、帳號狀態與管理權限。" : "跨平台集中管理教材、會員、AI 模型與營運資料；類科專屬內容仍在各自工作區處理。"}</span>
          </div>
        </div>
        {independentMode && <nav className="central-admin-tabs" aria-label="中央管理功能切換">
          <a className={libraryMode ? "active" : ""} href="/admin/library">教材向量庫</a>
          <a className={questionBankMode ? "active" : ""} href="/admin/question-bank">總題庫管理</a>
          <a href="/admin/products">書籍與商品</a>
          <a className={memberMode ? "active" : ""} href="/admin/members">會員總管理</a>
          <a href="/admin/ai-access">AI 方案與啟用碼</a>
          <a href="/admin/portal-cards">首頁卡片管理</a>
        </nav>}
        {!independentMode && <section className="admin-platform-switcher" aria-label="平台管理入口">
          <a href="/law"><span className="law">律</span><div><strong>司律備考</strong><small>進入法律學習平台</small></div>→</a>
          <a href="/medtech/admin"><span className="medtech">醫</span><div><strong>醫檢師管理</strong><small>題庫、語音與點數</small></div>→</a>
          <a href="/accounting/admin"><span className="accounting">會</span><div><strong>會計管理</strong><small>教材與課業答疑</small></div>→</a>
          <a href="/data-structure/admin"><span className="data">資</span><div><strong>資料結構管理</strong><small>教材與圖形索引</small></div>→</a>
        </section>}
        {!independentMode && <nav className="admin-tabs" aria-label="後台功能切換">
          <span className="admin-nav-section">公司共用</span>
          <a className="active" href="/admin/library">
            中央教材資料庫
          </a>
          <a href="/admin/question-bank">
            總題庫管理
          </a>
          <a href="/admin/products">
            書籍與商品
          </a>
          <a href="/admin/members">
            會員與權限
          </a>
          <a href="/admin/ai-access">
            AI 方案與啟用碼
          </a>
          <a href="/admin/portal-cards">
            首頁卡片管理
          </a>
          <button
            className={activeTab === "costs" ? "active" : ""}
            onClick={() => setActiveTab("costs")}
          >
            模型與成本
          </button>
          <span className="admin-nav-section">內容與課程</span>
          <button
            className={activeTab === "resources" ? "active" : ""}
            onClick={() => setActiveTab("resources")}
          >
            書籍管理
          </button>
          <button
            className={activeTab === "courses" ? "active" : ""}
            onClick={() => setActiveTab("courses")}
          >
            影音課程
          </button>
          <button
            className={activeTab === "course-collections" ? "active" : ""}
            onClick={() => setActiveTab("course-collections")}
          >
            課程專區
          </button>
          <button
            className={activeTab === "trials" ? "active" : ""}
            onClick={() => setActiveTab("trials")}
          >
            知識達試聽
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
            月旦法學教室
          </button>
          <button className={activeTab === "external-index" ? "active" : ""} onClick={() => setActiveTab("external-index")}>
            資源同步
          </button>
          <span className="admin-nav-section">司律專屬</span>
          <button
            className={activeTab === "legal" ? "active" : ""}
            onClick={() => setActiveTab("legal")}
          >
            法規與憲法法庭
          </button>
          <button
            className={activeTab === "judicial" ? "active" : ""}
            onClick={() => setActiveTab("judicial")}
          >
            司法院裁判
          </button>
          <button
            className={activeTab === "sources" ? "active" : ""}
            onClick={() => setActiveTab("sources")}
          >
            真題與外部來源
          </button>
          <button
            className={activeTab === "questions" ? "active" : ""}
            onClick={() => setActiveTab("questions")}
          >
            真題審核／編輯
          </button>
          <span className="admin-nav-section">品質與首頁</span>
          <button className={activeTab === "ai-feedback" ? "active" : ""} onClick={() => setActiveTab("ai-feedback")}>AI 回答覆核</button>
          <button
            className={activeTab === "homepage" ? "active" : ""}
            onClick={() => setActiveTab("homepage")}
          >
            首頁與播放
          </button>
        </nav>}
        {activeTab === "question-bank" && <section className="panel company-question-bank">
          <header className="company-question-bank-heading">
            <div><p>COMPANY QUESTION BANK</p><h2>總題庫管理</h2><span>各類科可自行上傳與處理；中央集中查看全部文件題庫、網址題庫、校對與發布狀態。</span></div>
            <strong>{questionBankSummary?.totals.reduce((sum, item) => sum + item.total, 0).toLocaleString() ?? "—"}<small> 題</small></strong>
          </header>
          {questionBankLoading ? <p className="usage-empty">正在彙整各平台題庫…</p> : <>
            <section className="question-bank-control-center" aria-label="中央題庫作業台">
              <div>
                <span>CENTRAL EDITING WORKSPACE</span>
                <h3>通用中央題庫工作流程</h3>
                <p>以完整題庫流程為母版，統一文件上傳、原稿對照、重新拆題、分類、逐題編輯、老師審題與發布；各類科只保留特殊屬性及學生端呈現。</p>
              </div>
              <nav className="question-bank-control-actions" aria-label="中央題庫主要頁面">
                <a className={questionBankSection === "questions" ? "active" : ""} href="/admin/question-bank/questions"><b>題目搜尋</b><small>分類、關鍵字、高亮與逐題管理</small></a>
                <a className={questionBankSection === "documents" ? "active" : ""} href="/admin/question-bank/documents"><b>文件管理</b><small>PDF、Word、HTML 分類與搜尋</small></a>
                <a href="/admin/question-bank/quality"><b>品質修復中心</b><small>自動掃描 P0／P1，儲存後下一題</small></a>
                <a className={questionBankSection === "sources" ? "active" : ""} href="/admin/question-bank/sources"><b>網址／PDF 擷取</b><small>直接網址、錯誤與左右對照</small></a>
                <a className={questionBankSection === "packages" ? "active" : ""} href="/admin/question-bank/packages"><b>組合包管理</b><small>勾選題目、建立與分派題包</small></a>
              </nav>
              <div className="question-bank-platform-editor-links">
                <strong>中央分類檢視</strong>
                <button type="button" onClick={() => { setQuestionBankCategory("law"); setQuestionBankSubject(""); }}>司律</button>
                <button type="button" onClick={() => { setQuestionBankCategory("medtech"); setQuestionBankSubject(""); }}>醫檢師</button>
                <button type="button" onClick={() => { setQuestionBankCategory("accounting"); setQuestionBankSubject(""); }}>會計</button>
                <button type="button" onClick={() => { setQuestionBankCategory("data-structure"); setQuestionBankSubject(""); }}>資料結構</button>
              </div>
            </section>
            <nav className="question-bank-platforms" aria-label="題庫類科篩選">
              {([['all', '全部題庫', '/admin?tab=question-bank'], ['law', '司律', '/admin?tab=questions'], ['medtech', '醫檢師', '/medtech/admin'], ['accounting', '會計', '/accounting/admin/questions'], ['data-structure', '資料結構', '/data-structure/admin']] as const).map(([value, label, href]) => {
                const total = value === 'all' ? questionBankSummary?.totals.reduce((sum, item) => sum + item.total, 0) ?? 0 : questionBankSummary?.totals.find((item) => item.examCategory === value)?.total ?? 0;
                return <article className={questionBankCategory === value ? "active" : ""} key={value}><button type="button" onClick={() => { setQuestionBankCategory(value); setQuestionBankSubject(""); }}><span>{label}</span><strong>{total.toLocaleString()} 題</strong></button>{!questionBankMode && value !== 'all' && <a href={href}>類科後台 →</a>}</article>;
              })}
            </nav>
            {(questionBankSection === "questions" || questionBankSection === "packages") && <><section className="central-question-search">
              <header>
                <div><h3>{questionBankSection === "packages" ? "搜尋題目並建立組合包" : "搜尋與分類題庫"}</h3><p>{questionBankSection === "packages" ? "先縮小題目範圍，再勾選單題建立及分派新的題目包。" : "依領域、考試項目、科目、章節／主題、年份、題型與狀態查找題目。"}</p></div>
                <span>{questionBankSummary?.questions?.length ?? 0} 筆結果 · 最多顯示 100 題</span>
              </header>
              <div className="central-question-filters">
                <label>領域<select value={questionBankDomain} onChange={(event) => { const value = event.target.value; setQuestionBankDomain(value); setQuestionBankSubject(""); setQuestionBankCategory(value === "law" ? "law" : value === "medical" ? "medtech" : value === "business" ? "accounting" : value === "information" ? "data-structure" : "all"); }}><option value="">全部領域</option><option value="law">法律</option><option value="medical">醫療</option><option value="business">商管／會計</option><option value="information">資訊</option></select></label>
                <label>考試項目<select value={questionBankCategory} onChange={(event) => { setQuestionBankCategory(event.target.value); setQuestionBankSubject(""); }}><option value="all">全部考試項目</option><option value="law">司律</option><option value="medtech">醫檢師</option><option value="accounting">會計類考試</option><option value="data-structure">資訊類考試</option></select></label>
                <label>關鍵字<input value={questionBankQuery} onChange={(event) => setQuestionBankQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loadQuestionBank(); } }} placeholder="輸入後按 Enter，例如：甲農場" /></label>
                <label>科目<select value={questionBankSubject} onChange={(event) => setQuestionBankSubject(event.target.value)}><option value="">全部科目</option>{(questionBankSummary?.subjects ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>章節／主題<input value={questionBankChapter} onChange={(event) => setQuestionBankChapter(event.target.value)} placeholder="例如：未遂犯、RNA 病毒" /></label>
                <label>年份<select value={questionBankYear} onChange={(event) => setQuestionBankYear(event.target.value)}><option value="">全部年份</option>{(questionBankSummary?.years ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>題型<select value={questionBankExamType} onChange={(event) => setQuestionBankExamType(event.target.value)}><option value="">全部題型</option><option value="mcq">選擇題</option><option value="essay">申論題</option></select></label>
                <label>狀態<select value={questionBankStatus} onChange={(event) => setQuestionBankStatus(event.target.value)}><option value="">全部狀態</option><option value="published">已發布</option><option value="draft">草稿</option><option value="disabled">已停用</option></select></label>
                <button type="button" onClick={() => void loadQuestionBank()}>搜尋題庫</button>
              </div>
              {questionBankSection === "packages" && <div className="central-question-package-bar">
                <label><input type="checkbox" checked={Boolean(questionBankSummary?.questions?.length) && selectedQuestionBankIds.length === questionBankSummary?.questions?.length} onChange={(event) => setSelectedQuestionBankIds(event.target.checked ? (questionBankSummary?.questions ?? []).map((item) => item.id) : [])} />全選目前結果</label>
                <strong>已選 {selectedQuestionBankIds.length} 題</strong>
                <input value={questionPackName} onChange={(event) => setQuestionPackName(event.target.value)} placeholder="組合包名稱（不是搜尋欄）" aria-label="組合包名稱，不是搜尋欄" />
                <button type="button" disabled={!selectedQuestionBankIds.length || !questionPackName.trim() || questionBankCategory === "all"} onClick={() => void createQuestionPack()}>建立組合包</button>
                {questionBankCategory === "all" && <small>請先選定一個類科，才能建立並分派組合包。</small>}
              </div>}
              {questionPackNotice && <p className="central-question-notice">{questionPackNotice}</p>}
              <div className="central-question-results">
                {(questionBankSummary?.questions ?? []).map((question) => <article className={questionBankSection === "questions" ? "without-selection" : ""} key={question.id}>
                  {questionBankSection === "packages" && <input type="checkbox" checked={selectedQuestionBankIds.includes(question.id)} onChange={(event) => setSelectedQuestionBankIds((current) => event.target.checked ? [...new Set([...current, question.id])] : current.filter((id) => id !== question.id))} aria-label={`選取第 ${question.questionNumber} 題`} />}
                  <div><small>{question.examCategory === "law" ? "司律" : question.examCategory === "medtech" ? "醫檢師" : question.examCategory === "accounting" ? "會計" : "資料結構"} · {question.subject} · {question.year} · {question.examType === "essay" ? "申論題" : "選擇題"}</small><strong>{highlightQuestionText(question.stem.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), [questionBankQuery, questionBankChapter].filter(Boolean).join(" "))}</strong><span>{highlightQuestionText(`${question.examName} · 第 ${question.questionNumber} 題`, [questionBankQuery, questionBankChapter].filter(Boolean).join(" "))}</span></div>
                  <em className={question.status}>{question.status === "published" ? "已發布" : question.status === "draft" ? "草稿" : "已停用"}</em>
                </article>)}
                {!questionBankSummary?.questions?.length && <p className="usage-empty">沒有符合條件的題目。</p>}
              </div>
              {questionBankSection === "packages" && !!questionBankSummary?.packages?.length && <details className="central-question-packages"><summary>查看已建立組合包（{questionBankSummary.packages.length}）</summary>{questionBankSummary.packages.map((item) => <article key={item.key}><div><b>{item.name}</b><span>{item.examCategory} · {item.status === "draft" ? "草稿" : item.status}</span></div><strong>{item.questionCount} 題</strong></article>)}</details>}
            </section>
            {questionBankSection === "questions" && <div className="question-bank-overview">
              {(questionBankSummary?.totals ?? []).filter((item) => questionBankCategory === 'all' || item.examCategory === questionBankCategory).map((item) => <article key={item.examCategory}>
                <span>{item.examCategory === 'law' ? '司律' : item.examCategory === 'medtech' ? '醫檢師' : item.examCategory === 'accounting' ? '會計' : item.examCategory === 'data-structure' ? '資料結構' : item.examCategory}</span>
                <strong>{item.total.toLocaleString()}</strong>
                <small>已發布 {item.published.toLocaleString()} · 待處理 {item.draft.toLocaleString()}</small>
              </article>)}
            </div>}</>}
            {questionBankSection === "sources" && <>
            <form className="central-pdf-source-form" onSubmit={addCentralPdfSource}>
              <header><div><h3>直接加入 PDF 網址</h3><p>貼上已知 PDF 網址，系統直接建立來源、下載並拆題，不必先搜尋目錄頁。</p></div></header>
              <label>題型<select value={centralPdfExamType} onChange={(event) => setCentralPdfExamType(event.target.value)}><option value="mcq">選擇題</option><option value="essay">申論題</option></select></label>
              <label>來源名稱<input value={centralPdfLabel} onChange={(event) => setCentralPdfLabel(event.target.value)} placeholder="例如：114 年司律二試刑法" /></label>
              <label className="pdf-url">PDF 網址<input type="url" value={centralPdfUrl} onChange={(event) => setCentralPdfUrl(event.target.value)} placeholder="https://fd.get.com.tw/.../128455.pdf" /></label>
              <button type="submit" disabled={centralPdfAdding || !centralPdfUrl.trim()}>{centralPdfAdding ? "加入並拆題中…" : "加入 PDF 並拆題"}</button>
            </form>
            {questionPackNotice && <p className="central-question-notice">{questionPackNotice}</p>}
            {(questionBankCategory === 'all' || questionBankCategory === 'law') && <div className="question-bank-files question-bank-url-sources">
              <header><div><h3>網址擷取來源</h3><p>選擇題與申論題來源集中在這裡，保留處理進度、錯誤與 PDF／題目左右對照。</p></div><span>{questionBankSummary?.urlSources?.length ?? 0} 個來源</span></header>
              {(questionBankSummary?.urlSources ?? []).map((source) => <article key={source.id}><span className="question-bank-file-mark law">網</span><div><small>司律 · {source.examType === 'essay' ? '申論題' : '選擇題'} · {source.sourceKind === 'exam' ? '歷屆真題' : source.sourceKind}</small><strong>{source.label}</strong><a className="question-bank-source-url" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>{source.lastError && <em>{source.lastError}</em>}</div><b>{source.questionCount.toLocaleString()}<small> 題</small></b><a href={source.sourceKind === "exam" ? `/admin/question-bank/source-workspace?sourceId=${source.id}` : "/admin?tab=sources"}>{source.examType === "essay" ? "申論題管理" : source.examType === "mcq" ? "選擇題管理" : "中央管理"}</a></article>)}
              {!questionBankSummary?.urlSources?.length && <p className="usage-empty">尚未建立網址題庫來源。</p>}
            </div>}
            </>}
            {questionBankSection === "documents" && <>
            <section className="question-bank-document-search">
              <header><div><h3>文件分類與搜尋</h3><p>只搜尋 PDF、Word、HTML 等原始文件，不會混入題目或網址來源。</p></div><span>{filteredQuestionBankFiles.length} 份文件</span></header>
              <div>
                <label>關鍵字<input value={questionBankDocumentQuery} onChange={(event) => setQuestionBankDocumentQuery(event.target.value)} placeholder="搜尋書名、檔名、科目" /></label>
                <label>科目<select value={questionBankDocumentSubject} onChange={(event) => setQuestionBankDocumentSubject(event.target.value)}><option value="">全部科目</option>{questionBankDocumentSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
                <label>文件格式<select value={questionBankDocumentType} onChange={(event) => setQuestionBankDocumentType(event.target.value)}><option value="">全部格式</option>{questionBankDocumentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label>處理狀態<select value={questionBankDocumentStatus} onChange={(event) => setQuestionBankDocumentStatus(event.target.value)}><option value="">全部狀態</option><option value="ready">已完成</option><option value="processing">處理中</option><option value="failed">處理失敗</option></select></label>
                <button type="button" onClick={() => { setQuestionBankDocumentQuery(""); setQuestionBankDocumentSubject(""); setQuestionBankDocumentType(""); setQuestionBankDocumentStatus(""); }}>清除條件</button>
              </div>
            </section>
            <div className="question-bank-files">
              <header><div><h3>文件清單</h3><p>原始文件各自保留題目清單，供拆題、逐題對照、版本更新與人工校正。</p></div><span>{filteredQuestionBankFiles.length} 份文件</span></header>
              {filteredQuestionBankFiles.map((file) => {
                const workspace = `/admin/question-bank/workspace?category=${file.examCategory}&id=${file.id}`;
                return <article key={file.id}><span className={`question-bank-file-mark ${file.examCategory}`}>{file.examCategory === 'law' ? '律' : file.examCategory === 'medtech' ? '醫' : file.examCategory === 'accounting' ? '會' : '資'}</span><div><small>{file.subject} · {file.documentType}</small><strong title={file.fileName}>{file.bookTitle || file.fileName}</strong><span>{file.pageCount ? `${file.pageCount} 頁 · ` : ''}{file.fileName}</span></div><b>{file.questionCount.toLocaleString()}<small> 題</small></b><div className="central-document-actions"><a href={workspace}>拆題與總編輯</a>{file.examCategory!=="law"&&<a href={"/admin/question-bank/quality?id="+file.id}>自動品質修復</a>}</div></article>;
              })}
              {!filteredQuestionBankFiles.length && <p className="usage-empty">沒有符合條件的文件。</p>}
            </div>
            </>}
          </>}
        </section>}
        {activeTab === "external-index" && <section className="panel external-index-admin">
          <div className="external-index-heading"><div><p>PUBLIC INDEX DEMO</p><h2>跨網站資源同步</h2><span>按一次同步即會由主目錄自動逐層探索；不下載付費文章、教材或影片全文。</span></div><label className="external-index-search"><span>搜尋目前網站資源</span><input value={externalQuery} onChange={(event) => { setExternalQuery(event.target.value); setExternalPage(1); }} placeholder="篇名、書名、課程或來源" /></label></div>
          <div className="external-source-tabs" role="tablist" aria-label="資源網站">{(["lawdata", "angle_books", "angle_media", "get", "ibrain"] as const).map((key) => { const config = key === "lawdata" ? { label: "元照雜誌", note: "雜誌種類、各期目錄、作者與公開試讀" } : key === "angle_books" ? { label: "元照圖書", note: "圖書分類、書單與單本書介紹" } : key === "angle_media" ? { label: "品評家", note: "公開文章、影音、作者與講者" } : key === "get" ? { label: "高點文化", note: "圖書目錄、考試分類、書單與單本書介紹" } : { label: "iBrain 知識達", note: "司律課程與試聽" }; const source = externalSources.find((item) => item.key === key); return <button type="button" role="tab" aria-selected={externalSourceTab === key} className={externalSourceTab === key ? "active" : ""} key={key} onClick={() => { setExternalSourceTab(key); setExternalPage(1); setExternalSelectedItemId(null); setExternalQuery(""); }}><span><b>{config.label}</b><small>{config.note}</small></span><strong>{source?.items.length ?? 0}<small> 筆</small></strong></button>; })}</div>
          {externalNotice && <p className="external-index-notice">{externalNotice}</p>}
          {externalLoading ? <p className="usage-empty">正在讀取同步紀錄…</p> : (() => {
            const source = externalSources.find((item) => item.key === externalSourceTab);
            if (!source) return <div className="external-index-empty"><b>這個來源尚未建立索引</b><span>按「開始同步」抓取公開資料，供首頁跨來源推薦。</span><button disabled={externalSyncing !== "" || externalDeleting !== ""} onClick={() => void syncExternalSource(externalSourceTab)}>{externalSyncing === externalSourceTab ? "同步中…" : "開始同步"}</button></div>;
            const selected = source.items.find((item) => item.id === externalSelectedItemId) ?? null;
            const parentTitle = selected?.title ?? "";
            const levelItems = selected
              ? source.items.filter((item) => item.parentTitle === parentTitle)
              : source.items.filter((item) => !item.parentTitle || (item.depth ?? 1) === 1);
            const filtered = levelItems.filter((item) => !externalQuery.trim() || `${source.label} ${item.title} ${item.summary}`.toLowerCase().includes(externalQuery.trim().toLowerCase()));
            const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
            const page = Math.min(externalPage, pageCount);
            const rows = filtered.slice((page - 1) * 10, page * 10);
            const parentItem = selected?.parentTitle ? source.items.find((item) => item.title === selected.parentTitle) : null;
            const selectedAuthor = selected?.summary.match(/作者：([^｜]+)/u)?.[1]?.trim() ?? "";
            const selectedSection = selected?.summary.match(/分類：([^｜]+)/u)?.[1]?.trim() ?? "";
            const hasArticleDetail = Boolean(selected && !selected.book && (selected.content?.trim() || selected.publicLinks?.length || selectedAuthor || selectedSection));
            const books = source.key === "get" ? source.items.filter((item) => item.book) : [];
            const authorBooks = books.filter((item) => item.book?.authors?.length).length;
            const catalogueBooks = books.filter((item) => item.book?.catalogue?.length).length;
            const descriptionBooks = books.filter((item) => item.book?.description).length;
            const completeBooks = books.filter((item) => (item.book?.completeness ?? 0) >= 80).length;
            const authorDirectory = Array.from(books.reduce((directory, item) => {
              for (const author of item.book?.authors ?? []) {
                const name = author.trim();
                if (!name) continue;
                const titles = directory.get(name) ?? [];
                if (!titles.includes(item.title)) titles.push(item.title);
                directory.set(name, titles);
              }
              return directory;
            }, new Map<string, string[]>()).entries()).sort((left, right) => left[0].localeCompare(right[0], "zh-Hant"));
            const percent = (count: number) => books.length ? Math.round(count / books.length * 100) : 0;
            const openItem = (id: number) => { setExternalSelectedItemId(id); setExternalPage(1); setExternalQuery(""); };
            const goBack = () => { setExternalSelectedItemId(parentItem?.id ?? null); setExternalPage(1); setExternalQuery(""); };
            return <div className="external-source-lists">{source.key === "get" && <><div className="external-book-coverage"><header><div><b>高點圖書資料完整率</b><span>逐本詳細頁核對；只有實際辨識出姓名才計入作者</span></div><strong>{books.length}<small> 本已辨識</small></strong></header><div><article><span>有作者姓名的書</span><b>{authorBooks}/{books.length}</b><em>{percent(authorBooks)}%</em></article><article><span>完整目錄</span><b>{catalogueBooks}/{books.length}</b><em>{percent(catalogueBooks)}%</em></article><article><span>書籍介紹</span><b>{descriptionBooks}/{books.length}</b><em>{percent(descriptionBooks)}%</em></article><article><span>整體達 80%</span><b>{completeBooks}/{books.length}</b><em>{percent(completeBooks)}%</em></article></div></div><details className="external-author-directory" open><summary><span><b>作者與著作</b><small>直接核對每位作者抓到哪些書</small></span><strong>{authorDirectory.length} 位作者</strong></summary><div>{authorDirectory.map(([author, titles]) => <article key={author}><header><b>{author}</b><span>{titles.length} 本</span></header><ul>{titles.map((title) => <li key={title}>{title}</li>)}</ul></article>)}</div>{authorDirectory.length === 0 && <p>目前沒有可辨識的作者姓名，不能算作者抓取完成。</p>}</details></>}<section>
              <header><div><h3>{selected ? selected.title : source.label}</h3><span>{selected ? hasArticleDetail ? `第 ${selected.depth ?? 1} 層 · 文章詳細資料已辨識` : `第 ${selected.depth ?? 1} 層 · ${levelItems.length} 筆下層資源` : `${source.items.filter((item) => item.enabled).length} 筆啟用／${source.items.length} 筆已抓取`}</span></div><div className="external-source-actions">{selected && <><button type="button" onClick={goBack}>← 回上一層</button><button type="button" className="external-retrieval-test-button" disabled={externalTestLoading} onClick={() => void testExternalHomepageRetrieval(selected)}>{externalTestLoading ? "測試中…" : "測試首頁檢索"}</button><button type="button" disabled={externalDeepSyncing !== null} onClick={() => void syncExternalChildren(source, selected)}>{externalDeepSyncing === selected.id ? "抓取中…" : hasArticleDetail || selected.kind === "detail" ? "補抓文章詳細資料" : "抓取此頁內層資料"}</button></>}<a href={selected?.url || source.sourceUrl} target="_blank" rel="noreferrer">查看原始頁面 ↗</a>{!selected && <><button className="danger" disabled={externalSyncing !== "" || externalDeleting !== "" || source.items.length === 0} onClick={() => void deleteExternalSource(source)}>{externalDeleting === source.key ? "清除中…" : "清除此來源舊資料"}</button><button disabled={externalSyncing !== "" || externalDeleting !== ""} onClick={() => void syncExternalSource(source.key)}>{externalSyncing === source.key ? "同步中…" : "重新同步"}</button></>}</div></header>
              <nav className="external-index-breadcrumb" aria-label="資源層級"><button type="button" onClick={() => { setExternalSelectedItemId(null); setExternalPage(1); setExternalQuery(""); }}>{source.label}</button>{parentItem && <><span>›</span><button type="button" onClick={() => openItem(parentItem.id)}>{parentItem.title}</button></>}{selected && <><span>›</span><strong>{selected.title}</strong></>}</nav>
              {selected && <div className="external-index-detail"><div><span>目前層級</span><strong>第 {selected.depth ?? 1} 層</strong></div><div><span>資料類型</span><strong>{selected.book ? "書籍詳細資料" : hasArticleDetail ? "文章詳細資料" : selected.kind === "detail" ? "主題／內容" : "分類／入口"}</strong></div><div><span>上層來源</span><strong>{selected.parentTitle || source.label}</strong></div><div><span>{hasArticleDetail ? "詳細資料" : "下層資料"}</span><strong>{hasArticleDetail ? "已抓取" : `${levelItems.length} 筆`}</strong></div>{selected.book?.authors?.length ? <div><span>作者</span><strong>{selected.book.authors.join("、")}</strong></div> : selectedAuthor ? <div><span>作者</span><strong>{selectedAuthor}</strong></div> : selected.teacher && <div><span>授課師資</span><strong>{selected.teacher}</strong></div>}{selectedSection && <div><span>文章分類</span><strong>{selectedSection}</strong></div>}{selected.book?.edition && <div><span>版次</span><strong>{selected.book.edition}</strong></div>}{selected.book?.publishedAt && <div><span>出版日期</span><strong>{selected.book.publishedAt}</strong></div>}{(selected.book?.isbn || selected.book?.bookCode) && <div><span>ISBN／書號</span><strong>{selected.book.isbn || selected.book.bookCode}</strong></div>}{selected.book && <div><span>資料完整度</span><strong>{selected.book.completeness ?? 0}%</strong></div>}<p>{selected.book?.description || selected.content || selected.summary}</p>{selected.publicLinks?.length ? <div className="external-article-public-links"><span>公開資源</span><strong>{selected.publicLinks.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</strong></div> : null}{selected.book?.catalogue?.length ? <details className="external-book-catalogue"><summary>查看完整目錄（{selected.book.catalogue.length} 項）</summary><ol>{selected.book.catalogue.map((row, index) => <li key={`${index}-${row}`}>{row}</li>)}</ol></details> : null}</div>}
              {selected && externalTestResult?.target.id === selected.id && <section className={`external-retrieval-test ${externalTestResult.complete ? "success" : "warning"}`}><header><div><span>首頁相同檢索流程</span><h4>{externalTestResult.complete ? "全部可以找到" : externalTestResult.found ? "部分資料可找到" : "目前全部找不到"}</h4></div><b>{externalTestResult.mode === "children" ? `下層 ${externalTestResult.stats.total} 筆批次測試` : "單筆測試"}</b></header><div className="external-retrieval-stats"><div><span>測試筆數</span><strong>{externalTestResult.stats.total}</strong></div><div className="complete"><span>完整命中</span><strong>{externalTestResult.stats.complete}</strong></div><div className="title-only"><span>僅標題</span><strong>{externalTestResult.stats.titleOnly}</strong></div><div className="missing"><span>找不到</span><strong>{externalTestResult.stats.missing}</strong></div><div><span>未啟用／索引</span><strong>{externalTestResult.stats.disabled}</strong></div></div><dl><div><dt>測試範圍</dt><dd>{externalTestResult.query}</dd></div><div><dt>所屬分類與來源</dt><dd>{externalTestResult.target.parentTitle || selected.title}｜{source.label}</dd></div>{externalTestResult.failureReason && <div className="failure"><dt>整體結果</dt><dd>{externalTestResult.failureReason}</dd></div>}</dl><div className="external-retrieval-items"><b>逐筆測試結果</b>{externalTestResult.tests.map((test) => <details key={test.id} className={test.complete ? "complete" : test.found ? "partial" : "missing"}><summary><div><strong>{test.title}</strong><span>{test.parentTitle || source.label}｜第 {test.depth} 層</span></div><em>{test.complete ? "完整命中" : test.found ? "僅命中標題" : "找不到"}</em></summary><div>{test.failureReason && <p className="failure-reason">{test.failureReason}</p>}{test.matches.length ? test.matches.map((match) => <article key={`${test.id}-${match.id}`}><div><strong>{match.title}</strong><span>{match.source}｜{match.parentTitle || "最上層資源"}</span></div><p>{match.excerpt || "此筆只有標題索引，沒有可顯示的內容片段。"}</p><small>{match.enabled ? "已啟用" : "未啟用"} · {match.indexed ? "已索引" : "未索引"}</small></article>) : <p className="external-retrieval-empty">沒有任何命中結果。</p>}</div></details>)}</div></section>}
              <div className="external-index-table"><div className="external-index-row table-head"><span>{selected ? "下一層資源" : "資源名稱"}</span><span>權限</span><span>首頁索引</span><span>使用</span></div>{rows.map((item) => { const childCount = source.items.filter((child) => child.parentTitle === item.title).length; return <div className="external-index-row" key={item.id}><div><div className="external-index-title-actions"><button type="button" className="external-index-title" onClick={() => openItem(item.id)}>{item.title}<span>查看已抓資料 ›</span></button><button type="button" className="external-index-row-test" disabled={externalTestLoading} onClick={() => void testExternalHomepageRetrieval(item)}>測試首頁檢索</button>{item.url ? <a className="external-index-origin-link" href={item.url} target="_blank" rel="noopener noreferrer">開啟原始頁面 ↗</a> : null}</div>{item.book?.authors?.length ? <small className="external-book-authors"><b>作者：</b>{item.book.authors.join("、")}</small> : null}<small>{item.summary}{childCount ? ` · ${childCount} 筆下層資料` : " · 最末層"}</small></div><span><em>公開索引</em></span><span className={item.indexed ? "indexed" : "disabled"}>{item.indexed ? "已索引" : "已停用"}</span><label className="external-index-toggle"><input type="checkbox" checked={item.enabled} onChange={(event) => void toggleExternalItem(item.id, event.target.checked)} /><span>{item.enabled ? "啟用" : "停用"}</span></label></div>; })}</div>
              {selected && levelItems.length === 0 && (hasArticleDetail ? <div className="external-index-leaf complete"><b>這筆已是文章詳細資料</b><span>作者、分類、公開導讀與試讀連結會直接保存於本篇，不需要再建立假的下一層。</span></div> : <div className="external-index-leaf"><b>尚未辨識到文章詳細資料</b><span>按右上角「補抓文章詳細資料」進入原始頁；若來源未公開作者、摘要或試讀，系統不會以假資料補齊。</span></div>)}
              {filtered.length === 0 && levelItems.length > 0 ? <p className="usage-empty">這一層沒有符合搜尋條件的資料。</p> : filtered.length > 0 && <nav className="external-pagination" aria-label="資源分頁"><span>第 {page}／{pageCount} 頁，共 {filtered.length} 筆</span><div><button disabled={page <= 1} onClick={() => setExternalPage(page - 1)}>上一頁</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={number === page ? "active" : ""} onClick={() => setExternalPage(number)}>{number}</button>)}<button disabled={page >= pageCount} onClick={() => setExternalPage(page + 1)}>下一頁</button></div></nav>}
            </section></div>;
          })()}
        </section>}
        {activeTab === "ai-feedback" && <section className="panel ai-feedback-admin"><div className="cost-heading"><div><h2>AI 回答覆核</h2><p className="panel-sub">學生回報先由 Sol 協助檢查，最後仍由老師確認是否有誤及是否寫回標準解析。</p></div><span className="source-count configured">{aiFeedback.length} 筆</span></div>{feedbackLoading ? <p>讀取回饋中…</p> : <div className="ai-feedback-list">{aiFeedback.map((item) => <article key={item.id}><header><div><b>{item.model || "AI 助教"}</b><span>{item.userKey} · {item.rating ? `${item.rating} 分` : "未評分"}</span></div><em>{item.reviewStatus === "pending" ? "待檢查" : item.reviewStatus === "ai_review_requested" ? "等待 Sol 覆核" : item.reviewStatus === "ai_reviewed" ? "AI 已覆核" : item.reviewStatus === "teacher_confirmed" ? "老師已確認" : item.reviewStatus === "corrected" ? "已修正" : "無需修正"}</em></header>{item.originalPrompt && <details><summary>學生原問題</summary><p>{item.originalPrompt}</p></details>}<details><summary>被回報的回答</summary><p>{item.messageText}</p></details><p className="student-feedback-note"><b>學生回饋：</b>{item.studentNote || "未補充說明"}</p><small>{item.errorTypes.join("、") || "未選錯誤類型"}</small><label>老師判斷<select value={item.teacherDecision} onChange={(event) => setAiFeedback((current) => current.map((row) => row.id === item.id ? { ...row, teacherDecision: event.target.value } : row))}><option value="">待確認</option><option value="confirmed_error">確認有誤</option><option value="no_error">確認無誤</option><option value="partly_correct">部分需修正</option></select></label><label>老師說明<textarea rows={3} value={item.teacherNote} onChange={(event) => setAiFeedback((current) => current.map((row) => row.id === item.id ? { ...row, teacherNote: event.target.value } : row))} /></label><label>修正後內容<textarea rows={5} value={item.correctedContent} onChange={(event) => setAiFeedback((current) => current.map((row) => row.id === item.id ? { ...row, correctedContent: event.target.value } : row))} /></label><div className="ai-feedback-actions"><button onClick={() => void updateAiFeedback(item.id, { reviewStatus: "teacher_confirmed", teacherDecision: item.teacherDecision, teacherNote: item.teacherNote, correctedContent: item.correctedContent })}>老師確認</button><button disabled={!item.correctedContent.trim()} onClick={() => void updateAiFeedback(item.id, { reviewStatus: "corrected", teacherDecision: item.teacherDecision, teacherNote: item.teacherNote, correctedContent: item.correctedContent })}>標記已修正</button><button onClick={() => void updateAiFeedback(item.id, { reviewStatus: "dismissed", teacherDecision: "no_error", teacherNote: item.teacherNote, correctedContent: item.correctedContent })}>確認無誤</button></div></article>)}</div>}</section>}
        {activeTab === "members" && (
          <section className="panel member-admin-panel">
            <div className="cost-heading"><div><h2>全平台會員總管理</h2><p className="panel-sub">中央顯示全部會員及其可使用類科；各類科後台仍只會看到自己的會員。</p></div><span className="source-count configured">{members.length} 位會員</span></div>
            <form className="member-create-form" onSubmit={createMember}>
              <div className="member-create-heading"><div><h3>新增學員</h3><p>先建立帳號；學員日後以相同 Email 登入，即會接上自己的學習平台。</p></div><button type="submit" disabled={memberCreating}>{memberCreating ? "新增中…" : "＋ 新增學員"}</button></div>
              <div className="member-create-fields">
                <label><span>姓名</span><input required value={newMember.displayName} onChange={(event) => setNewMember((current) => ({ ...current, displayName: event.target.value }))} placeholder="例如：王小明" /></label>
                <label><span>Email</span><input required type="email" value={newMember.email} onChange={(event) => setNewMember((current) => ({ ...current, email: event.target.value }))} placeholder="student@example.com" /></label>
                <label><span>初始密碼（至少 8 碼）</span><input required minLength={8} type="password" autoComplete="new-password" value={newMember.password} onChange={(event) => setNewMember((current) => ({ ...current, password: event.target.value }))} placeholder="提供給會員登入" /></label>
                <label><span>班級</span><input value={newMember.className} onChange={(event) => setNewMember((current) => ({ ...current, className: event.target.value }))} placeholder="例如：司律二試 A 班" /></label>
                <label><span>學習身分</span><select value={newMember.role} onChange={(event) => setNewMember((current) => ({ ...current, role: event.target.value as MemberRow["role"] }))}><option value="student">學員</option><option value="teacher">老師／導師</option></select></label>
                <label><span>帳號狀態</span><select value={newMember.status} onChange={(event) => setNewMember((current) => ({ ...current, status: event.target.value as MemberRow["status"] }))}><option value="active">使用中</option><option value="disabled">暫不開放</option></select></label>
              </div>
            </form>
            {memberNotice && <p className="member-admin-notice">{memberNotice}</p>}
            {!membersLoading && members.some((member) => member.passwordResetRequestedAt) && <section className="member-reset-queue">
              <header><div><span>待處理</span><h3>密碼重設申請</h3><p>目前採人工重設，不會寄信。確認會員身分後設定臨時密碼，再用既有聯絡方式通知會員。</p></div><strong>{members.filter((member) => member.passwordResetRequestedAt).length} 筆</strong></header>
              <div>{members.filter((member) => member.passwordResetRequestedAt).map((member) => <article key={`reset-${member.id}`}>
                <div><b>{member.displayName || "未設定姓名"}</b><span>{member.email}</span><small>申請時間：{new Date(member.passwordResetRequestedAt!).toLocaleString("zh-TW")}</small></div>
                <button type="button" onClick={() => { const password = window.prompt(`設定 ${member.displayName || member.email} 的臨時密碼（至少 8 碼）`); if (password) void updateMember(member.id, { password }); }}>設定臨時密碼並完成</button>
              </article>)}</div>
            </section>}
            {membersLoading ? <p className="usage-empty">正在讀取學員資料…</p> : <div className="member-admin-list">
              {members.map((member) => <article className="member-admin-row" key={member.id}>
                <div className="member-identity"><span>{member.displayName?.slice(0, 1) || "學"}</span><div><strong>{member.displayName || "未設定姓名"}</strong><small>{member.email}</small>{member.passwordResetRequestedAt && <b className="member-password-reset-alert">申請重設密碼 · {new Date(member.passwordResetRequestedAt).toLocaleString("zh-TW")}</b>}<div className="member-platform-access">{member.accesses?.length ? member.accesses.map((access) => <em className={access.status === 'active' ? 'active' : 'disabled'} key={access.examCategory}>{access.examCategory === 'law' ? '司律' : access.examCategory === 'medtech' ? '醫檢師' : access.examCategory === 'accounting' ? '會計' : access.examCategory === 'data-structure' ? '資料結構' : access.examCategory}</em>) : <em className="active">司律</em>}</div></div></div>
                <label><span>學習身分</span><select value={member.role} onChange={(event) => void updateMember(member.id, { role: event.target.value as MemberRow["role"] })}><option value="student">學員</option><option value="teacher">老師／導師</option></select></label>
                <label><span>管理權限</span><select value={member.canAdmin ? "enabled" : "disabled"} onChange={(event) => void updateMember(member.id, { canAdmin: event.target.value === "enabled" })}><option value="disabled">無</option><option value="enabled">管理員</option></select></label>
                <label><span>班級</span><input value={member.className} onChange={(event) => setMembers((rows) => rows.map((row) => row.id === member.id ? { ...row, className: event.target.value } : row))} onBlur={(event) => void updateMember(member.id, { className: event.target.value })} /></label>
                <label><span>帳號狀態</span><select value={member.status} onChange={(event) => void updateMember(member.id, { status: event.target.value as MemberRow["status"] })}><option value="active">使用中</option><option value="disabled">已停用</option></select></label>
                <div className="member-last-seen"><span>最後使用</span><strong>{member.lastSeenAt ? new Date(member.lastSeenAt).toLocaleString("zh-TW") : "尚未登入"}</strong></div>
                <button type="button" className="member-reset-password" onClick={() => { const password = window.prompt(`設定 ${member.displayName || member.email} 的新密碼（至少 8 碼）`); if (password) void updateMember(member.id, { password }); }}>重設密碼</button>
                <details className="member-payment-history"><summary>購買紀錄（{member.paymentOrders?.length ?? 0} 筆）</summary>{member.paymentOrders?.length ? <div>{member.paymentOrders.map((order) => <article key={order.orderId}><strong>{order.packageName}</strong><span>{order.currency} {order.amount} · {order.status === "paid" ? "已付款" : order.status === "pending" ? "待付款" : order.status === "authorized" ? "已授權" : order.status}</span><small>訂單 {order.orderId}{order.transactionId ? ` · 交易 ${order.transactionId}` : ""}</small><small>{order.paidAt ? `付款：${new Date(order.paidAt).toLocaleString("zh-TW")}` : `建立：${new Date(order.createdAt).toLocaleString("zh-TW")}`}{order.activatedAt ? ` · 開通：${new Date(order.activatedAt).toLocaleString("zh-TW")}` : ""}</small></article>)}</div> : <p>目前沒有付款訂單。</p>}</details>
              </article>)}
              {!members.length && <p className="usage-empty">尚無會員。學生首次登入後會自動出現在這裡。</p>}
            </div>}
            <div className="cost-heading"><div><h3>會員自助刪除稽核</h3><p className="panel-sub">不保留姓名、Email、IP 或裝置明文；付款資料僅以證明編號去識別化保留。</p></div><span className="source-count configured">{memberDeletionAudits.length} 筆</span></div>
            <div className="member-admin-list">{memberDeletionAudits.map((audit) => <article className="member-admin-row" key={audit.id}><div className="member-identity"><span>刪</span><div><strong>{audit.deletionRef}</strong><small>{new Date(audit.requestedAt).toLocaleString("zh-TW")}</small></div></div><div className="member-last-seen"><span>執行方式</span><strong>會員自助／密碼再次驗證</strong></div><div className="member-last-seen"><span>結果</span><strong>{audit.outcome === "completed" ? "已完成" : audit.outcome === "failed" ? "未完成" : "處理中"}</strong></div><div className="member-last-seen"><span>付款紀錄</span><strong>{audit.retainedPaymentOrders} 筆（{audit.paymentDataAnonymized ? "已匿名" : "待處理"}）</strong></div></article>)}</div>
          </section>
        )}
        {activeTab === "homepage" && (
          <section className="panel site-settings-panel">
            <div className="setting-block">
              <div className="setting-block-head simulation-master-setting">
                <div>
                  <h3>管理測試與模擬回答</h3>
                  <p>一鍵隱藏首頁、智能書、申論引導、爭點辨識、讀書會與會計答疑中的模擬學生、測試擬答、程度與模型測試工具；一般學生作答與正式 AI 回覆不受影響。</p>
                  <strong className={`simulation-master-status ${simulationToolsEnabled ? "is-on" : "is-off"}`}>
                    模擬功能目前：{simulationToolsEnabled ? "開啟" : "關閉"}
                  </strong>
                </div>
                <button type="button" className={`simulation-master-button ${simulationToolsEnabled ? "turn-off" : "turn-on"}`} disabled={savingSimulationTools} onClick={() => void toggleSimulationTools()}>
                  {savingSimulationTools ? "正在更新…" : simulationToolsEnabled ? "一鍵關閉全部模擬" : "重新開啟模擬功能"}
                </button>
              </div>
            </div>
            <div className="setting-block">
              <div className="setting-block-head"><div><h3>學習專區入口</h3><p>可先隱藏首頁的「學習專區」按鈕；再次開啟時，會員原有進度與紀錄仍會保留。</p></div><label className="cost-toggle"><input type="checkbox" checked={learningCenterEnabled} disabled={savingLearningCenter} onChange={() => void toggleLearningCenter()} /><span>{savingLearningCenter ? "更新中…" : learningCenterEnabled ? "目前開放" : "目前關閉"}</span></label></div>
            </div>
            <div className="setting-block home-web-search-setting">
              <div className="setting-block-head"><div><h3>首頁回答｜外網搜尋</h3><p>讓 Luna 在首頁回答時查證特定作者、著作、判決與最新資料。回答會列出實際來源網址，並計入本次成本。</p></div><span className={`source-count ${homeWebSearchMode === "off" ? "" : "configured"}`}>{homeWebSearchMode === "off" ? "未啟用" : "試驗中"}</span></div>
              <div className="web-search-mode-options" role="radiogroup" aria-label="首頁外網搜尋模式">
                <label><input type="radio" name="home-web-search" checked={homeWebSearchMode === "off"} disabled={savingWebSearchMode} onChange={() => void saveHomeWebSearchMode("off")} /><span><b>關閉</b><small>只使用站內教材、題庫與既有索引</small></span></label>
                <label><input type="radio" name="home-web-search" checked={homeWebSearchMode === "fallback"} disabled={savingWebSearchMode} onChange={() => void saveHomeWebSearchMode("fallback")} /><span><b>站內不足才搜尋（建議）</b><small>作者、著作、特定判決或最新資料不足時才查外網</small></span></label>
                <label><input type="radio" name="home-web-search" checked={homeWebSearchMode === "always"} disabled={savingWebSearchMode} onChange={() => void saveHomeWebSearchMode("always")} /><span><b>每次都搜尋</b><small>方便短期比較效果，但速度與費用較高</small></span></label>
              </div>
              <p className="web-search-trust-note">優先來源：司法院、全國法規資料庫、考選部、政府機關、大學、出版社與作者官方頁面。AI 必須區分原文、作者主張與整理推論。</p>
            </div>
            <div className="cost-heading">
              <div>
                <h2>首頁與播放設定</h2>
                <p className="panel-sub">在後台設定一支 YouTube 無版權／創作者授權音樂，前台首頁與學習專區會顯示播放器。</p>
              </div>
              <span className={`source-count ${focusMusicUrl ? "configured" : ""}`}>{focusMusicUrl ? "已設定" : "尚未設定"}</span>
            </div>
            <div className="homepage-setting-block">
              <div className="setting-block-head"><div><h3>考試倒數</h3><p>同學可自行填考試科目或名稱與日期；首頁自動顯示最近一場。</p></div><button type="button" onClick={() => setExamCountdowns((items) => [...items, { id: `exam-${Date.now()}`, label: "", date: "", enabled: true }])}>＋ 新增考試</button></div>
              <div className="settings-list">{examCountdowns.length ? examCountdowns.map((exam, index) => <div className="setting-row exam-setting-row" key={exam.id}><label><span>考試科目／名稱</span><input value={exam.label} onChange={(event) => setExamCountdowns((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="例如：司律一試" /></label><label><span>考試日期</span><input type="date" value={exam.date} onChange={(event) => setExamCountdowns((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item))} /></label><label className="setting-enabled"><input type="checkbox" checked={exam.enabled} onChange={(event) => setExamCountdowns((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />顯示</label><button type="button" className="setting-remove" onClick={() => setExamCountdowns((items) => items.filter((_, itemIndex) => itemIndex !== index))}>刪除</button></div>) : <p className="settings-empty">尚未設定考試日期。新增後，倒數才會出現在首頁。</p>}</div>
            </div>
            <div className="homepage-setting-block">
              <div className="setting-block-head"><div><h3>作戰快訊</h3><p>填入跑馬燈文字，可選填點擊後開啟的連結。</p></div><button type="button" onClick={() => setBattleAlerts((items) => [...items, { id: `alert-${Date.now()}`, text: "", url: "", enabled: true }])}>＋ 新增快訊</button></div>
              <div className="settings-list">{battleAlerts.length ? battleAlerts.map((alert, index) => <div className="setting-row alert-setting-row" key={alert.id}><label><span>快訊文字</span><input value={alert.text} onChange={(event) => setBattleAlerts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} placeholder="例如：114 年二試考題解析已上線" /></label><label><span>連結（選填）</span><input type="url" value={alert.url} onChange={(event) => setBattleAlerts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} placeholder="https://…" /></label><label className="setting-enabled"><input type="checkbox" checked={alert.enabled} onChange={(event) => setBattleAlerts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />顯示</label><button type="button" className="setting-remove" onClick={() => setBattleAlerts((items) => items.filter((_, itemIndex) => itemIndex !== index))}>刪除</button></div>) : <p className="settings-empty">尚未新增作戰快訊。</p>}</div>
            </div>
            <div className="homepage-save-bar"><button type="button" className="primary-btn" disabled={savingHomepage} onClick={() => void saveHomepageSettings()}>{savingHomepage ? "儲存中…" : "儲存倒數與作戰快訊"}</button></div>
            <form className="site-setting-form" onSubmit={saveFocusMusic}>
              <label className="field">讀書音樂 YouTube 網址<input value={focusMusicDraft} onChange={(event) => setFocusMusicDraft(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
              <div className="site-setting-actions"><button type="submit" className="primary-btn" disabled={savingFocusMusic}>{savingFocusMusic ? "儲存中…" : "儲存並發布到前台"}</button><button type="button" onClick={() => setFocusMusicDraft("")}>清除</button></div>
            </form>
            <p className="music-note">前台不會自動播放有聲音的內容，需由同學按下播放；請先確認音樂的 YouTube 授權條件。</p>
            <div className="homepage-sync-grid">
              <div><span>讀書音樂</span><strong>{focusMusicUrl ? "已設定，首頁上方可播放" : "尚未設定"}</strong></div>
              <div><span>法教專區</span><strong>{resources.filter((item) => item.resourceType === "magazine" && item.status === "active").length ? "已發布，首頁列出四篇試讀" : "尚未發布"}</strong></div>
              <div><span>聽解題</span><strong>{listeningItems.some((item) => item.status === "published" && (item.audioStorageKey || item.audioFileName)) ? "已發布音檔" : "請完成音檔與發布"}</strong></div>
              <div><span>日期／天氣／運試</span><strong>首頁依台北日期即時同步</strong></div>
            </div>
          </section>
        )}
        {activeTab === "course-collections" && (
          <section className="panel course-collection-manager">
            <div className="cost-heading">
              <div>
                <h2>課程專區管理</h2>
                <p className="panel-sub">
                  建立「專區 → 科目 → 公開課程」的整理方式。專區發布後，學生會在學習專區的「課程專區」看到內容；課程本身仍由「影音課程」管理。
                </p>
              </div>
              <span className="source-count">{courseCollections.length} 個專區</span>
            </div>
            <form className="collection-create-form" onSubmit={createCourseCollection}>
              <label className="field">專區名稱<input value={collectionTitle} onChange={(event) => setCollectionTitle(event.target.value)} placeholder="例如：台大開放課程" /></label>
              <label className="field">專區介紹<input value={collectionDescription} onChange={(event) => setCollectionDescription(event.target.value)} placeholder="例如：各科公開課程整理，作為備考補充" /></label>
              <label className="field">狀態<select value={collectionStatus} onChange={(event) => setCollectionStatus(event.target.value)}><option value="draft">草稿</option><option value="active">發布</option></select></label>
              <button type="submit" className="primary-btn" disabled={!collectionTitle.trim()}>建立專區</button>
            </form>
            <form className="collection-attach-form" onSubmit={addCourseToCollection}>
              <div><strong>把影音課程放入專區</strong><span>先在「影音課程」建立 YouTube 影片／播放清單，再在這裡選擇。</span></div>
              <label className="field">選擇專區<select value={selectedCollectionId ?? ""} onChange={(event) => setSelectedCollectionId(Number(event.target.value) || null)}><option value="">請選擇</option>{courseCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
              <label className="field">選擇影音課程<select value={selectedCollectionResourceId} onChange={(event) => setSelectedCollectionResourceId(event.target.value)}><option value="">請選擇</option>{resources.filter((resource) => resource.resourceType === "course" && resource.status !== "archived").map((resource) => <option key={resource.id} value={resource.id}>{resource.subject}｜{resource.title}</option>)}</select></label>
              <button type="submit" className="primary-btn" disabled={!selectedCollectionId || !selectedCollectionResourceId}>加入專區</button>
            </form>
            {notice && <div className="notice">{notice}</div>}
            <div className="course-collection-list">
              {courseCollections.length ? courseCollections.map((collection) => (
                <article className="course-collection-admin-card" key={collection.id}>
                  <div className="course-collection-admin-head">
                    <div><span>課程專區</span><strong>{collection.courses.length} 堂課</strong></div>
                    <button type="button" className="danger-text-button" onClick={() => void removeCourseCollection(collection)}>移除專區</button>
                  </div>
                  <div className="course-collection-edit-grid">
                    <label className="field">專區名稱<input value={collection.title} onChange={(event) => setCourseCollections((items) => items.map((item) => item.id === collection.id ? { ...item, title: event.target.value } : item))} onBlur={(event) => void updateCourseCollection(collection, { title: event.target.value })} /></label>
                    <label className="field">顯示狀態<select value={collection.status} onChange={(event) => { setCourseCollections((items) => items.map((item) => item.id === collection.id ? { ...item, status: event.target.value } : item)); void updateCourseCollection(collection, { status: event.target.value }); }}><option value="draft">草稿</option><option value="active">已發布</option></select></label>
                    <label className="field collection-description-field">專區介紹<input value={collection.description} onChange={(event) => setCourseCollections((items) => items.map((item) => item.id === collection.id ? { ...item, description: event.target.value } : item))} onBlur={(event) => void updateCourseCollection(collection, { description: event.target.value })} /></label>
                  </div>
                  <div className="course-collection-course-list">
                    {collection.courses.length ? collection.courses.map((course) => (
                      <div className="course-collection-course-row" key={course.itemId}>
                        <span>{course.subject}</span><strong>{course.title}</strong><small>{course.creator || "未設定老師"}</small><button type="button" onClick={() => void removeCourseFromCollection(course.itemId)}>移除</button>
                      </div>
                    )) : <p>目前尚未放入課程；可在上方選擇影音課程加入。</p>}
                  </div>
                </article>
              )) : <div className="collection-empty">尚未建立課程專區。先建立一個專區，再放入不同科目的公開課程。</div>}
            </div>
          </section>
        )}
        {activeTab === "costs" && (
          <section className="cost-panel panel">
            <div className="homepage-setting-block">
              <div className="setting-block-head">
                <div>
                  <h3>正式申論批改｜進階模型比較</h3>
                  <p>目前關閉時一律由 Luna 進行初步批改，再交由老師確認；需要測試時可開啟 Sol、Luna 與雙模型分頁／分割比較。</p>
                </div>
                <label className="cost-toggle">
                  <input type="checkbox" checked={usage?.essayGradingDualEnabled ?? false} onChange={toggleEssayGradingDual} />
                  <span />
                  {usage?.essayGradingDualEnabled ?? false ? "目前開放" : "目前關閉"}
                </label>
              </div>
            </div>
            <div className="homepage-setting-block">
              <div className="setting-block-head">
                <div>
                  <h3>智譜 GLM-4.7-Flash</h3>
                  <p>使用伺服器端金鑰進行最小連線測試；金鑰不會傳到瀏覽器。建議環境變數名稱使用 <code>ZAI_API_KEY</code>。</p>
                </div>
                <button type="button" className="primary-btn" disabled={glmTesting} onClick={() => void testGlmConnection()}>{glmTesting ? "測試中…" : "測試 GLM 連線"}</button>
              </div>
              {glmTestResult?.ok ? <div className="notice"><strong>連線成功｜{glmTestResult.model}</strong><p>{glmTestResult.text}</p><small>輸入 {glmTestResult.inputTokens ?? 0} · 輸出 {glmTestResult.outputTokens ?? 0} · 合計 {glmTestResult.totalTokens ?? 0} tokens｜{glmTestResult.durationMs ?? 0} ms｜推理費 US$ {(glmTestResult.estimatedCostUsd ?? 0).toFixed(5)}</small></div> : glmTestResult?.error ? <div className="notice error">{glmTestResult.error}</div> : null}
            </div>
            <div className="cost-heading">
              <div>
                <h2>AI 使用成本</h2>
                <p className="panel-sub">
                  依實際 API usage 記錄，供未來方案與收費評估；台幣以 1 USD ≈ NT$ {USD_TO_TWD_RATE} 暫估。
                </p>
              </div>
              <label className="cost-toggle">
                <input
                  type="checkbox"
                  checked={usage?.showCosts ?? false}
                  onChange={toggleFrontendCosts}
                />
                <span />
                前台顯示成本
              </label>
            </div>
            <div className="cost-metrics">
              <div>
                <span>累計對話</span>
                <strong>
                  {Number(usage?.totals.requests ?? 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span>輸入 Token</span>
                <strong>
                  {Number(usage?.totals.inputTokens ?? 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span>輸出 Token</span>
                <strong>
                  {Number(usage?.totals.outputTokens ?? 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span>快取 Token</span>
                <strong>
                  {Number(usage?.totals.cachedTokens ?? 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span>教材搜尋</span>
                <strong>
                  {Number(usage?.totals.fileSearchCalls ?? 0).toLocaleString()}
                </strong>
              </div>
              <div className="cost-total">
                <span>估算總成本</span>
                <strong>
                  US${" "}
                  {(Number(usage?.totals.costMicros ?? 0) / 1_000_000).toFixed(
                    4,
                  )} · 約 NT$ {formatTwd(Number(usage?.totals.costMicros ?? 0) / 1_000_000, 2)}
                </strong>
              </div>
            </div>
            <section className="comparison-admin-summary" aria-label="教材編輯成本彙整">
              <div className="cost-heading"><div><h3>教材編輯成本彙整</h3><p className="panel-sub">集中累積中會、醫檢與其他類科後台的 OCR、圖片轉文字／表格、AI 擬答及完整解析成本；規則式掃描與批次修復為 0 token。</p></div><span className="source-count">{usage?.editorTotals?.requests ?? 0} 次付費編輯</span></div>
              <div className="cost-metrics comparison-metrics"><div><span>輸入 Token</span><strong>{Number(usage?.editorTotals?.inputTokens ?? 0).toLocaleString()}</strong></div><div><span>輸出 Token</span><strong>{Number(usage?.editorTotals?.outputTokens ?? 0).toLocaleString()}</strong></div><div><span>快取 Token</span><strong>{Number(usage?.editorTotals?.cachedTokens ?? 0).toLocaleString()}</strong></div><div className="cost-total"><span>編輯累計成本</span><strong>US$ {(Number(usage?.editorTotals?.costMicros ?? 0)/1_000_000).toFixed(5)} · 約 NT$ {formatTwd(Number(usage?.editorTotals?.costMicros ?? 0)/1_000_000,2)}</strong></div></div>
              {usage?.editorRecent?.length?<div className="comparison-admin-list">{usage.editorRecent.slice(0,20).map(row=><article key={row.id}><header><strong>{row.source}</strong><span>{(row.inputTokens+row.outputTokens).toLocaleString()} tokens · US$ {(row.estimatedCostUsdMicros/1_000_000).toFixed(6)}</span><small>{new Date(row.createdAt).toLocaleString("zh-TW")}</small></header></article>)}</div>:<p className="usage-empty">尚未產生需使用 Token 的教材編輯紀錄。</p>}
            </section>
            <section className="comparison-admin-summary" aria-label="雙模型比較統計">
              <div className="cost-heading"><div><h3>AI 導師模型比較</h3><p className="panel-sub">前台測試者可比較 Luna、Claude Sonnet 與 DeepSeek V4-Pro；這裡顯示各模型的實際回覆、Token、耗時、成本與回饋。</p></div><span className="source-count">{usage?.comparisonStats?.comparisons ?? 0} 次比較</span></div>
              <div className="cost-metrics comparison-metrics"><div><span>已評分回答</span><strong>{usage?.comparisonStats?.ratedResponses ?? 0}</strong></div><div><span>Luna 被選較多</span><strong>{usage?.comparisonStats?.lunaPreferred ?? 0}</strong></div><div><span>Sonnet 被選較多</span><strong>{usage?.comparisonStats?.claudePreferred ?? 0}</strong></div><div><span>DeepSeek 被選較多</span><strong>{usage?.comparisonStats?.deepseekPreferred ?? 0}</strong></div><div><span>平均評分</span><strong>{Number(usage?.comparisonStats?.averageScore ?? 0).toFixed(2)} / 5</strong></div></div>
              {usage?.recentComparisons?.length ? <div className="comparison-admin-list">{usage.recentComparisons.slice(0, 10).map((comparison) => <article key={comparison.id}><header><strong>#{comparison.id}</strong><span>{comparison.promptText.slice(0, 100)}</span><small>{new Date(comparison.createdAt).toLocaleString("zh-TW")}</small></header><div>{comparison.responses.map((response) => <p key={response.id}><b>{response.label}</b><span>{response.inputTokens + response.outputTokens} tokens · {response.durationMs.toLocaleString()} ms · US$ {(response.estimatedCostUsdMicros / 1_000_000).toFixed(5)}</span><em>{response.ratings.length ? `評分 ${response.ratings.map((rating) => rating.score).join("、")}` : "尚未評分"}{response.error ? ` · ${response.error}` : ""}</em></p>)}</div></article>)}</div> : <p className="usage-empty">尚未產生模型比較。前台選擇任一比較組合後，結果會出現在這裡。</p>}
            </section>
            {usage?.recent?.length ? (
              <>
                <div className="usage-table-wrap">
                  <table className="usage-table">
                    <thead>
                      <tr>
                        <th>時間</th>
                        <th>模型</th>
                        <th>依據</th>
                        <th>輸入</th>
                        <th>快取</th>
                        <th>輸出</th>
                        <th>搜尋</th>
                        <th>成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUsage.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {new Date(row.createdAt).toLocaleString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>{row.model.replace("gpt-5.6-", "")}</td>
                          <td>{row.source}</td>
                          <td>{row.inputTokens.toLocaleString()}</td>
                          <td>{row.cachedTokens.toLocaleString()}</td>
                          <td>{row.outputTokens.toLocaleString()}</td>
                          <td>{row.fileSearchCalls}</td>
                          <td>
                            US${" "}
                            {(row.estimatedCostUsdMicros / 1_000_000).toFixed(
                              5,
                            )} ·<br />約 NT$ {formatTwd(row.estimatedCostUsdMicros / 1_000_000, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(usage?.recent.length ?? 0) > USAGE_PER_PAGE && (
                  <nav
                    className="document-pagination usage-pagination"
                    aria-label="AI 成本明細分頁"
                  >
                    <button
                      type="button"
                      disabled={usagePage === 1}
                      onClick={() =>
                        setUsagePage((page) => Math.max(1, page - 1))
                      }
                    >
                      上一頁
                    </button>
                    <span>
                      第 {usagePage} / {usagePageCount} 頁 · 每頁 10 筆
                    </span>
                    <button
                      type="button"
                      disabled={usagePage === usagePageCount}
                      onClick={() =>
                        setUsagePage((page) =>
                          Math.min(usagePageCount, page + 1),
                        )
                      }
                    >
                      下一頁
                    </button>
                  </nav>
                )}
              </>
            ) : (
              <p className="usage-empty">
                新版本發布後產生的 AI 對話，會開始記錄在這裡。
              </p>
            )}
          </section>
        )}
        {activeTab === "documents" && (
          <>
          {libraryMode && <section className="library-storage-architecture panel">
            <div><p>PRIVATE SOURCE STORAGE</p><h2>原始 PDF 留在公司本機</h2><span>RTX 4090 24GB／64GB RAM 可先擔任私有教材節點；雲端平台只接收必要的文字切片、索引識別碼與檢索結果，不必保存原始 PDF。</span></div>
            <div className={`library-node-status ${localNodeStatus.connected ? "connected" : "offline"}`}>
              <strong>{localNodeStatus.node?.name ?? "本機節點"}</strong>
              <span>{localNodeStatus.connected ? localNodeStatus.node?.status === "busy" ? "處理中" : localNodeStatus.node?.status === "error" ? "需檢查" : "已連線" : "尚未連線"}</span>
              <small>{localNodeStatus.node
                ? `${localNodeStatus.node.gpu}${localNodeStatus.node.gpuMemoryGb ? ` ${localNodeStatus.node.gpuMemoryGb}GB` : ""}${localNodeStatus.node.ramGb ? `／RAM ${localNodeStatus.node.ramGb}GB` : ""} · ${localNodeStatus.node.models.length ? `模型 ${localNodeStatus.node.models.join("、")}` : "尚未回報模型"}`
                : "安裝本機節點服務並設定專用金鑰後，狀態會自動更新。"}</small>
              {localNodeStatus.node && <small>最後回報：{new Date(localNodeStatus.node.lastSeenAt).toLocaleString("zh-TW")} · 版本 {localNodeStatus.node.version}</small>}
            </div>
          </section>}
          {libraryMode && <LocalNodeJobsPanel />}
          {libraryMode && <SitesCloudflareSyncDownload />}
          {libraryMode && <DocumentIndexHealthPanel />}
          {libraryMode && <nav className="library-section-tabs" aria-label="教材資料庫操作切換">
            <button type="button" className={librarySection === "materials" ? "active" : ""} onClick={() => setLibrarySection("materials")}><strong>教材列表</strong><span>搜尋、索引狀態與細部資料</span></button>
            <button type="button" className={librarySection === "upload" ? "active" : ""} onClick={() => setLibrarySection("upload")}><strong>上傳教材</strong><span>新增檔案與查看處理進度</span></button>
          </nav>}
          <div className={`admin-grid ${libraryMode ? "library-admin-stack" : ""}`}>
            {(!libraryMode || librarySection === "upload") && (
            <form className="panel" onSubmit={submit}>
              <h2>上傳教材</h2>
              <p className="panel-sub">
                上傳後由系統自動檢查檔案、擷取文字、整理章節／題目、建立標籤與索引；不同類科的教材與題庫不會混用。
              </p>
              <label
                className={`upload-zone ${dragActive ? "drag-active" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!uploading) setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  if (!uploading) setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (event.currentTarget === event.target)
                    setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  if (!uploading)
                    chooseFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jsonl,.md,.txt,.docx,.zip,application/pdf,application/jsonl,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip"
                  multiple
                  hidden
                  onChange={(e) => chooseFiles(e.target.files)}
                />
                <span className="upload-icon">＋</span>
                <strong>
                  {dragActive
                    ? "放開滑鼠，加入批次佇列"
                    : queue.length
                      ? `已選擇 ${queue.length} 份教材`
                    : "拖曳 PDF、JSONL、MD、TXT、DOCX 或 ZIP 到這裡"}
                </strong>
                <span>
                  {queue.length
                    ? `共 ${(queue.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(1)} MB · 還可以繼續拖入更多檔案`
                    : "或點此批次選取；系統會逐份檢查、解析、分類並建立索引"}
                </span>
              </label>
              {queue.length > 0 && (
                <div className="upload-queue">
                  {queue.map((item, index) => (
                    <div className="queue-row" key={item.key}>
                      <div className="queue-index">{index + 1}</div>
                      <div className="queue-main">
                        <div>
                          <strong>{item.file.name}</strong>
                          <span>
                            {item.status === "queued"
                              ? "等待上傳"
                              : item.status === "uploading"
                                ? `上傳中 ${item.progress}%`
                                : item.status === "indexing"
                                  ? "AI 自動檢查／解析／索引中"
                                : item.status === "done"
                                    ? "已完成自動處理"
                                    : `失敗 · ${item.error ?? "請重試"}`}
                          </span>
                        </div>
                        <div className="queue-progress">
                          <i style={{ width: `${item.progress}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="meta-fields">
                <label className="field">
                  類科
                  <select value={examCategory} onChange={(e) => { const next = e.target.value as "law" | "accounting" | "medtech"; setExamCategory(next); setSubject(next === "law" ? "刑法" : next === "accounting" ? "中級會計學" : "臨床病毒學"); setDocumentPage(1); setSelectedDocumentIds([]); }}>
                    <option value="law">司律</option>
                    <option value="accounting">會計</option>
                    <option value="medtech">醫檢師</option>
                  </select>
                </label>
                <label className="field">
                  科目
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  >
                    {examCategory === "law" ? <><option>刑法</option><option>刑事訴訟法</option><option>民法</option><option>民事訴訟法</option><option>憲法</option><option>行政法</option><option>商事法</option></> : examCategory === "accounting" ? <><option>中級會計學</option><option>高等會計學</option><option>成本與管理會計</option><option>審計學</option><option>稅務法規</option></> : <><option>臨床病毒學</option><option>臨床血液學</option><option>臨床生化學</option><option>臨床微生物學</option><option>血庫學</option><option>醫學分子檢驗學</option></>}
                  </select>
                </label>
                <label className="field">
                  文件類型
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option>教科書</option>
                    <option>解題書</option>
                    <option>講義</option>
                    <option>歷屆試題</option>
                    <option>老師擬答</option>
                  </select>
                </label>
              </div>
              <button
                className="primary-btn"
                type="submit"
                disabled={
                  !queue.some(
                    (item) =>
                      item.status === "queued" || item.status === "failed",
                  ) || uploading
                }
              >
                {uploading
                  ? "批次處理中，請勿關閉頁面…"
                  : queue.some((item) => item.status === "failed")
                    ? "重試失敗項目"
                    : `依序上傳 ${queue.length || ""} 份並自動處理`}
              </button>
              {notice && <div className="notice">{notice}</div>}
            </form>
            )}
            {(!libraryMode || librarySection === "materials") && (
            <section className="panel document-panel">
              <div className="document-list-heading">
                <div><h2>公司教材與索引狀態</h2><label className="library-document-search"><span>搜尋教材</span><input type="search" value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); setDocumentPage(1); }} placeholder="書名、檔名、科目、標籤…" /></label></div>
                {categoryFiles.length > 0 && (
                  <div className="document-batch-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={categoryFiles.length > 0 && selectedDocumentIds.length === categoryFiles.length}
                        onChange={(event) => setSelectedDocumentIds(event.target.checked ? categoryFiles.map((file) => file.id) : [])}
                      />
                      全選
                    </label>
                    <button type="button" disabled={!selectedDocumentIds.length || deletingDocuments} onClick={() => void deleteSelectedDocuments()}>
                      {deletingDocuments ? "刪除中…" : `刪除已選（${selectedDocumentIds.length}）`}
                    </button>
                  </div>
                )}
              </div>
              <p className="panel-sub">
                每本書只上傳一次；可同時關聯司律、醫檢師與會計平台。系統保留 PDF 原始頁碼，並可再拆成約 760 字的重疊片段，兼顧精準命中與上下文完整。
              </p>
              {categoryFiles.length === 0 ? (
                <div className="empty-state">
                  公司教材資料庫目前尚未上傳文件
                  <br />
                  第一份教材會顯示在這裡
                </div>
              ) : (
                <div className="file-list">
                  {visibleFiles.map((file) => {
                    const ready = file.status === "completed";
                    const failed = file.status === "failed";
                    const waiting = ["uploaded", "queued"].includes(file.processingStage ?? file.status);
                    const stageLabel = file.processingStage === "extracting"
                      ? "檔案檢查／文字擷取"
                      : file.processingStage === "indexing" || file.status === "in_progress"
                        ? "全文／向量索引"
                        : file.processingStage === "analyzing"
                          ? "AI 章節／題目／分類分析"
                          : file.processingStage === "completed"
                            ? "已完成"
                            : file.processingMessage ?? "等待自動處理";
                    return (
                      <div className="file-card" key={file.id}>
                        <input
                          className="document-select"
                          type="checkbox"
                          aria-label={`選取 ${file.name}`}
                          checked={selectedDocumentIds.includes(file.id)}
                          onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))}
                        />
                        <span className="file-type">{file.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
                        <div className="file-info">
                          <strong className="document-file-name" title={file.name}>{file.name}</strong>
                          <label className="document-display-name">
                            <span>前台教材名稱</span>
                            <input
                              value={file.bookTitle ?? ""}
                              placeholder={documentDisplayTitle(null, file.name)}
                              aria-label={`${file.name}的前台教材名稱`}
                              onChange={(event) => setFiles((current) => current.map((item) => item.id === file.id ? { ...item, bookTitle: event.target.value } : item))}
                              onBlur={() => void saveDocumentBookTitle(file)}
                              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
                            />
                            <small>離開欄位會自動儲存；學生端只顯示這個名稱。</small>
                          </label>
                          <small className="document-source-name">完整原始檔名：{file.name}</small>
                          <span>
                            {(file.examCategory === "medtech" ? "醫檢師" : file.examCategory === "accounting" ? "會計" : "司律")} · {file.subject} · {file.size}
                          </span>
                          <small>{stageLabel}{file.error ? ` · ${file.error}` : ""}</small>
                          {ready && (
                            <small className="document-index-summary">
                              {file.fullTextIndexed ? "✓ 全文索引完成" : "○ 全文索引待確認"} · {file.vectorIndexed ? "✓ 向量索引完成" : "⚠ 向量索引待確認"}
                            </small>
                          )}
                          {(ready || file.processingStage === "analyzing") && (
                            <small className="document-facts">
                              {file.pageCount ? `${file.pageCount} 頁 · ` : ""}
                              {file.extractedChars ? `${file.extractedChars.toLocaleString()} 字 · ` : file.name.toLowerCase().endsWith(".pdf") || file.name.toLowerCase().endsWith(".zip") ? "PDF文字由索引服務擷取 · " : ""}
                              {file.chapterCount ?? 0} 章 · {file.questionCount ?? 0} 題
                              {file.tags?.length ? ` · ${file.tags.slice(0, 5).join("、")}` : ""}
                            </small>
                          )}
                          {ready && (
                            <div className="document-granular-index">
                              <div>
                                <strong>精準搜尋索引</strong>
                                <small>{file.fineSearchUnitCount ? `已建立 ${file.fineSearchUnitCount.toLocaleString()} 個頁面級片段` : "尚未建立細粒度片段；目前仍可使用全文向量搜尋"}</small>
                              </div>
                              <button type="button" onClick={() => void buildFineSearchIndex(file)} disabled={fineIndexingDocumentId !== null}>
                                {fineIndexingDocumentId === file.id ? "逐頁拆解中…" : file.fineSearchUnitCount ? "檢查並補齊索引" : "建立精準索引"}
                              </button>
                            </div>
                          )}
                          {ready && (
                            <div className="document-platform-links">
                              <strong>使用平台</strong>
                              {([['law', '司律'], ['pengli', '彭狸老師'], ['medtech', '醫檢師'], ['accounting', '會計']] as const).map(([value, label]) => {
                                const enabled = (file.assignmentCategories?.length ? file.assignmentCategories : [file.examCategory ?? 'law']).includes(value);
                                return <button key={value} type="button" className={enabled ? "active" : ""} onClick={() => void toggleDocumentAssignment(file, value)}>{enabled ? "✓ " : "+ "}{label}</button>;
                              })}
                              <small>可跨平台共用檔案，但搜尋時只會進入已勾選的平台。</small>
                            </div>
                          )}
                          {ready && (file.summary || file.chapters?.length || file.questions?.length) && (
                            <details className="document-result">
                              <summary>查看自動處理結果</summary>
                              {file.sourceFileName && file.sourceFileName !== file.name && (
                                <small>ZIP 來源：{file.sourceFileName}；實際索引：{file.indexedFileName ?? file.name}</small>
                              )}
                              {file.summary && <p>{file.summary}</p>}
                              <div className="document-result-columns">
                                {file.chapters?.length ? (
                                  <div>
                                    <strong>章節／主題</strong>
                                    <ul>{file.chapters.slice(0, 8).map((chapter, index) => <li key={`${chapter.title}-${index}`}>{chapter.path && `${chapter.path}｜`}{chapter.title}</li>)}</ul>
                                    {(file.chapterCount ?? 0) > 8 && <small>另有 {(file.chapterCount ?? 0) - 8} 章已保存於索引</small>}
                                  </div>
                                ) : null}
                                {file.questions?.length ? (
                                  <div>
                                    <strong>題目／題型</strong>
                                    <ul>{file.questions.slice(0, 8).map((question, index) => <li key={`${question.number}-${question.title}-${index}`}>{question.number ? `第 ${question.number} 題｜` : ""}{question.title}</li>)}</ul>
                                    {(file.questionCount ?? 0) > 8 && <small>另有 {(file.questionCount ?? 0) - 8} 題已保存於索引</small>}
                                  </div>
                                ) : null}
                              </div>
                              {file.extractionNote && <small className="document-result-note">{file.extractionNote}</small>}
                              <div className="document-index-badges"><span>{file.fullTextIndexed ? "✓ 全文索引" : "○ 全文索引"}</span><span>{file.vectorIndexed ? "✓ 向量索引" : "○ 向量索引"}</span><span>{file.analysisStatus === "completed" ? "✓ AI 結構分析" : "已完成技術索引"}</span></div>
                            </details>
                          )}
                          {ready && (
                            <div className="document-search-test">
                              <div className="document-search-test-heading">
                                <strong>內部向量檢索測試</strong>
                                <small>只測這一份教材，不影響學生端設定</small>
                              </div>
                              <div className="document-search-test-controls">
                                <input
                                  type="search"
                                  value={documentSearchQueries[file.id] ?? ""}
                                  placeholder="例如：未遂、第三章、構成要件"
                                  aria-label={`${file.name}的向量索引測試關鍵字`}
                                  onChange={(event) => setDocumentSearchQueries((current) => ({ ...current, [file.id]: event.target.value }))}
                                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void testDocumentSearch(file); } }}
                                />
                                <button type="button" onClick={() => void testDocumentSearch(file)} disabled={documentSearchTests[file.id]?.status === "testing" || !file.vectorIndexed}>
                                  {documentSearchTests[file.id]?.status === "testing" ? "測試中…" : "測試命中"}
                                </button>
                                <button type="button" className="auto-test" onClick={() => void autoTestDocumentSearch(file)} disabled={documentSearchTests[file.id]?.status === "testing" || !file.vectorIndexed}>
                                  {documentSearchTests[file.id]?.status === "testing" ? "測試中…" : "AI 自動測試"}
                                </button>
                              </div>
                              {documentSearchTests[file.id]?.status === "error" && (
                                <small className="document-search-test-error">{documentSearchTests[file.id]?.error}</small>
                              )}
                              {documentSearchTests[file.id]?.status === "testing" && !!documentSearchTests[file.id]?.autoResults?.length && (
                                <div className="document-search-test-result testing">
                                  <strong>{documentSearchTests[file.id]?.query}</strong>
                                  <ul className="document-auto-test-results">{documentSearchTests[file.id]?.autoResults?.map((item) => <li className={item.hit ? "pass" : "fail"} key={item.query}><b>{item.hit ? "✓" : "✕"} 測試：「{item.query}」</b><span>{item.hit ? `${item.hits} 個可核對片段${item.page ? ` · 第 ${item.page} 頁` : ""}${item.retrievalMode ? ` · ${item.retrievalMode === "fine_lexical" ? "頁面索引" : "向量索引"}` : ""}` : "未通過實質核對"}</span>{item.title && <small>命中標題：{item.title}</small>}{item.reason && <small>判定依據：{item.reason}</small>}{item.excerpt && <small className="document-test-excerpt">關鍵詞附近原文：{item.excerpt}</small>}</li>)}</ul>
                                </div>
                              )}
                              {documentSearchTests[file.id]?.status === "success" && (
                                <div className={`document-search-test-result ${documentSearchTests[file.id]?.selectedFileWasSearched ? "hit" : "miss"}`}>
                                  {documentSearchTests[file.id]?.autoResults?.length ? <><strong>實質核對通過 {documentSearchTests[file.id]?.autoResults?.filter((item) => item.hit).length} / {documentSearchTests[file.id]?.autoResults?.length} 組</strong><small>只有測試詞能在顯示原文中直接核對，才計為通過。</small><ul className="document-auto-test-results">{documentSearchTests[file.id]?.autoResults?.map((item) => <li className={item.hit ? "pass" : "fail"} key={item.query}><b>{item.hit ? "✓" : "✕"} 測試：「{item.query}」</b><span>{item.hit ? `${item.hits} 個可核對片段${item.page ? ` · 第 ${item.page} 頁` : ""}${item.retrievalMode ? ` · ${item.retrievalMode === "fine_lexical" ? "頁面索引" : "向量索引"}` : ""}` : "未通過實質核對"}</span>{item.title && <small>命中標題：{item.title}</small>}{item.reason && <small>判定依據：{item.reason}</small>}{item.excerpt && <small className="document-test-excerpt">關鍵詞附近原文：{item.excerpt}</small>}</li>)}</ul></> : <strong>{documentSearchTests[file.id]?.selectedFileWasSearched ? `已命中 ${documentSearchTests[file.id]?.hits?.length ?? 0} 個片段` : "未命中這份指定教材"}</strong>}
                                  {!!documentSearchTests[file.id]?.hits?.length && (
                                    <ul>
                                      {documentSearchTests[file.id]?.hits?.slice(0, 3).map((hit, index) => (
                                        <li key={`${hit.fileName}-${index}`}>
                                          {hit.pageStart ? `第 ${hit.pageStart}${hit.pageEnd && hit.pageEnd !== hit.pageStart ? `–${hit.pageEnd}` : ""} 頁｜` : ""}{hit.text}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                              <details className="document-search-history" onToggle={(event) => { if (event.currentTarget.open) void loadDocumentSearchHistory(file.id); }}>
                                <summary>查看最近測試紀錄</summary>
                                {(documentSearchHistory[file.id] ?? []).map((run) => <article key={run.id}><header><b>{new Date(run.createdAt).toLocaleString("zh-TW")}</b><strong>{run.passed} / {run.total} 組通過</strong></header><ul>{run.results.map((item) => <li key={`${run.id}-${item.query}`}><span>{item.hit ? "✓" : "✕"} 測試：「{item.query}」</span><small>{item.hit ? `${item.hits} 個片段${item.page ? ` · 第 ${item.page} 頁` : ""}${item.retrievalMode ? ` · ${item.retrievalMode === "fine_lexical" ? "頁面索引" : "向量索引"}` : ""}` : "未命中"}</small>{item.excerpt && <small className="document-test-excerpt">命中原文：{item.excerpt}</small>}</li>)}</ul></article>)}
                                {!documentSearchHistory[file.id]?.length && <small>尚無已保存的自動測試紀錄。</small>}
                              </details>
                            </div>
                          )}
                        </div>
                        <div className="file-card-actions">
                          {ready && (
                            <label className={`homepage-search-toggle ${file.homepageSearchEnabled ? "enabled" : ""}`}>
                              <input type="checkbox" checked={Boolean(file.homepageSearchEnabled)} onChange={() => void toggleHomepageDocument(file)} />
                              <span>{file.homepageSearchEnabled ? "首頁可搜尋" : "允許首頁搜尋"}</span>
                            </label>
                          )}
                          {failed ? (
                            <button className="index-btn" onClick={() => startIndex(file.id)}>重新處理</button>
                          ) : (
                            <span className={`status ${ready ? "" : "pending"}`}>
                              {ready ? "索引完成" : waiting ? "等待處理" : "處理中"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="index-metrics" aria-label="教材索引即時統計">
                <div>
                  <span>全公司向量可搜尋</span>
                  <strong>
                    {categoryFiles.filter((file) => file.vectorIndexed).length} / {categoryFiles.length}
                  </strong>
                </div>
                <div>
                  <span>索引容量</span>
                  <strong>
                    {(documentStats.indexedBytes / 1024 / 1024).toFixed(1)} MB
                  </strong>
                </div>
                <div>
                  <span>教材引用</span>
                  <strong>{documentStats.citations}</strong>
                </div>
                <div>
                  <span>未命中問題</span>
                  <strong>{documentStats.misses}</strong>
                </div>
                <div className="index-version">
                  <span>索引版本</span>
                  <strong>{documentStats.indexVersion}</strong>
                </div>
              </div>
              {categoryFiles.length > DOCUMENTS_PER_PAGE && (
                <nav className="document-pagination" aria-label="文件清單分頁">
                  <button
                    type="button"
                    disabled={documentPage === 1}
                    onClick={() =>
                      setDocumentPage((page) => Math.max(1, page - 1))
                    }
                  >
                    上一頁
                  </button>
                  <span>
                    第 {documentPage} / {documentPageCount} 頁
                  </span>
                  <button
                    type="button"
                    disabled={documentPage === documentPageCount}
                    onClick={() =>
                      setDocumentPage((page) =>
                        Math.min(documentPageCount, page + 1),
                      )
                    }
                  >
                    下一頁
                  </button>
                </nav>
              )}
            </section>
            )}
          </div>
          </>
        )}
        {(activeTab === "resources" || activeTab === "courses" || activeTab === "trials") && (
          <section className="panel resource-manager">
            {activeTab === "resources" && (
              <div className="evidence-verification-setting">
                <div>
                  <span className="evidence-setting-kicker">智能書測試工具</span>
                  <h2>教材原文驗證模式</h2>
                  <p>開啟後，學生在智能書取得 AI 導師回答時，可展開查看實際命中的教材片段、頁碼與檢索方式；測試完成後可隨時關閉。</p>
                </div>
                <label className="cost-toggle evidence-main-toggle">
                  <input type="checkbox" checked={usage?.showEvidence ?? false} onChange={toggleTeachingEvidence} />
                  <span />
                  {usage?.showEvidence ? "驗證模式已開啟" : "開啟驗證模式"}
                </label>
              </div>
            )}
            <div className="cost-heading">
              <div>
                <h2>{activeTab === "trials" ? "知識達試聽管理" : "書籍與課程管理"}</h2>
                <p className="panel-sub">
                  {activeTab === "trials" ? "新增老師、科目、課程簡介與知識達官方試聽連結；前台只提供外部入口，不搬動或播放影片。" : "書籍綁定教材文件並管理書封；影音課程可嵌入 YouTube 單支影片、播放清單或 HLS／MP4，並可搭配字幕整理學習重點。"}
                </p>
              </div>
              <span className="source-count">{resources.length} 項資源</span>
            </div>
            <form className="resource-form" onSubmit={addResource}>
              <label className="field">
                資源類型
                <select
                  value={activeTab === "courses" ? "course" : activeTab === "trials" ? "trial" : "book"}
                  onChange={(e) => setResourceType(e.target.value)}
                  disabled
                >
                  <option value="book">書籍</option>
                  <option value="course">影音課程</option>
                  <option value="trial">知識達試聽</option>
                </select>
              </label>
              <label className="field">
                名稱
                <input
                  value={resourceTitle}
                  onChange={(e) => setResourceTitle(e.target.value)}
                  placeholder="例如：透明的刑法－總則編"
                />
              </label>
              <label className="field">
                作者／老師
                <input
                  value={resourceCreator}
                  onChange={(e) => setResourceCreator(e.target.value)}
                  placeholder="張鏡榮律師"
                />
              </label>
              {activeTab === "trials" && <label className="field">科目<select value={resourceSubject} onChange={(e) => setResourceSubject(e.target.value)}>{["民法", "刑法", "憲法", "行政法", "民事訴訟法", "刑事訴訟法", "商事法", "選試科目"].map((item) => <option key={item}>{item}</option>)}</select></label>}
              {activeTab === "trials" && <label className="field">課程簡介<input value={resourceDescription} onChange={(e) => setResourceDescription(e.target.value)} placeholder="例如：適合初學者建立刑法基本架構" /></label>}
              {activeTab === "courses" || activeTab === "trials" ? (
                <label className="field">
                  {activeTab === "trials" ? "知識達官方試聽網址" : "課程／來源網址"}
                  <input
                    type="url"
                    value={resourceUrl}
                    onChange={(e) => setResourceUrl(e.target.value)}
                    placeholder={activeTab === "trials" ? "https://www.ibrain.com.tw/audition/ListDetail.aspx?…" : "https://www.youtube.com/watch?v=… 或 playlist?list=…"}
                  />
                  <small className="field-hint">{activeTab === "trials" ? "學生點擊後會另開此官方頁面。" : "可貼 YouTube 影片／播放清單網址，或可直接播放的 .m3u8／.mp4；ibrain 課程頁網址不能直接嵌入。"}</small>
                </label>
              ) : (
                <div className="field resource-create-hint">
                  <span>教材文件</span>
                  <strong>建立後在書卡上選擇</strong>
                </div>
              )}
              <button className="primary-btn" disabled={!resourceTitle.trim()}>
                建立資源
              </button>
            </form>
            {notice && <div className="notice">{notice}</div>}
            <div className="resource-grid magazine-resource-grid">
              {orderedResourceGroup(activeTab === "courses" ? "course" : activeTab === "trials" ? "trial" : "book").map((resource, resourceIndex) => (
                  <article className="resource-card magazine-resource-card" key={resource.id}>
                    <div className="resource-cover">
                      {resource.hasCover ? (
                        <img
                          src={`/api/resources/cover?id=${resource.id}`}
                          alt={`${resource.title}書封`}
                        />
                      ) : (
                        <span>
                          {resource.resourceType === "course"
                            ? "課"
                            : resource.resourceType === "magazine"
                              ? "刊"
                              : "書"}
                        </span>
                      )}
                    </div>
                    <div className="resource-info">
                      <span>
                        {resource.resourceType === "course"
                          ? "影音課程"
                          : resource.resourceType === "magazine"
                            ? "期刊"
                            : "書籍"}{" "}
                        · {resource.subject}
                      </span>
                      <h3>{resource.title}</h3>
                      <p>{resource.creator || "尚未設定作者／老師"}</p>
                      <small>
                        {resource.resourceType === "book"
                          ? resource.documentId
                            ? resource.documentStatus === "completed"
                              ? `技術索引：全文${resource.documentFullTextIndexed ? "✓" : "待確認"}、向量${resource.documentVectorIndexed ? "✓" : "待確認"}；AI 結構：${resource.documentTopicCount ?? resource.documentChapterCount ?? 0} ${isProblemSolvingResource(resource) ? "個主題" : "章"}／${resource.documentQuestionCount ?? 0} 題`
                              : "教材已綁定，正在自動解析與建立索引"
                            : "尚未綁定教材文件"
                          : resource.sourceUrl
                            ? "已設定課程來源網址"
                            : "尚未設定課程來源網址"}
                        {resource.resourceType === "course" &&
                          ` · ${resource.segmentCount} 個字幕學習片段`}
                      </small>
                    </div>
                    <div className="resource-actions">
                      <div className="resource-order-actions" aria-label={`${resource.title}排序`}>
                        <span>第 {resourceIndex + 1} 順位</span>
                        <button type="button" onClick={() => void moveResource(resource, -1)} disabled={resourceIndex === 0} aria-label="上移">↑</button>
                        <button type="button" onClick={() => void moveResource(resource, 1)} disabled={resourceIndex === orderedResourceGroup(resource.resourceType).length - 1} aria-label="下移">↓</button>
                      </div>
                      {resource.resourceType === "book" && (
                        <>
                          {(() => {
                            const query = resourceDocumentQueries[resource.id] ?? "";
                            const candidateFiles = searchableDocuments(files, "law", resource.subject, query, resource.documentId);
                            const selectedFile = files.find((file) => file.id === resource.documentId);
                            return (
                              <div className="resource-document-picker">
                                <label>
                                  <span>搜尋教材文件</span>
                                  <input
                                    type="search"
                                    value={query}
                                    placeholder={`搜尋「${resource.subject || "教材"}」名稱、檔名或關鍵字`}
                                    aria-label={`${resource.title}搜尋教材文件`}
                                    onChange={(event) => setResourceDocumentQueries((current) => ({ ...current, [resource.id]: event.target.value }))}
                                  />
                                </label>
                                <label>
                                  <span>綁定教材文件</span>
                                  <select
                                    aria-label={`${resource.title}綁定教材文件`}
                                    value={resource.documentId ?? ""}
                                    onChange={(event) => bindBookDocument(resource, event.target.value)}
                                  >
                                    <option value="">選擇教材文件</option>
                                    {candidateFiles.map((file) => (
                                      <option key={file.id} value={file.id} title={file.name}>
                                        {documentOptionLabel(file)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <small>
                                  {candidateFiles.length
                                    ? `目前顯示 ${candidateFiles.length} 份「${resource.subject || "相符"}」司律教材`
                                    : `找不到「${resource.subject || "這本書"}」的司律教材文件；請先到教材知識庫確認類科與科目。`}
                                </small>
                                {selectedFile && (selectedFile.examCategory ?? "law") !== "law" && <small className="resource-document-warning">⚠ 目前綁定的是非司律文件，請重新選擇司律教材。</small>}
                                {selectedFile && (selectedFile.examCategory ?? "law") === "law" && <small className="resource-document-source">目前完整檔名：{selectedFile.name}</small>}
                              </div>
                            );
                          })()}
                          <details className="resource-manage-details">
                            <summary>
                              <span>教材處理與管理</span>
                              <small>
                                {chapterSourceRunning === resource.id
                                  ? "原文補齊中…"
                                  : Number(resource.chapterCount ?? resource.storedChapterCatalogueCount ?? 0) > 0
                                    ? `原文 ${Math.min(Number(resource.chapterCount ?? resource.storedChapterCatalogueCount ?? 0), Number(resource.chapterSourceReadyCount ?? 0))}／${Number(resource.chapterCount ?? resource.storedChapterCatalogueCount ?? 0)}`
                                    : resource.documentId
                                      ? "尚未建立章節索引"
                                      : "尚未綁定教材"}
                              </small>
                            </summary>
                            <div className="resource-manage-content">
                          {resource.documentId && (
                            <div className={`chapter-progress-panel ${resource.documentVectorIndexed ? "completed" : "paused"}`} role="status">
                              <div className="chapter-progress-heading">
                                <strong>
                                  {resource.documentStatus === "completed"
                                    ? `技術索引：全文${resource.documentFullTextIndexed ? "已完成" : "待確認"}／向量${resource.documentVectorIndexed ? "已完成" : "待確認"}`
                                    : resource.documentProcessingMessage ?? "教材正在自動處理"}
                                </strong>
                              </div>
                              <div className="chapter-progress-meta">
                                <span>
                                  {resource.documentStatus === "completed"
                                    ? (() => {
                                        const progress = chapterProgress[resource.id];
                                        const storedTopics = Math.max(resource.documentTopicCount ?? 0, resource.documentChapterCount ?? 0);
                                        const storedQuestions = resource.documentQuestionCount ?? 0;
                                        const topics = storedTopics || (progress?.completedTopics ?? 0);
                                        const questions = storedQuestions || (progress?.foundQuestions ?? 0);
                                        const running = progress && progress.state !== "completed" && progress.totalTopics;
                                        return running
                                          ? `AI 結構分析：${progress.completedTopics ?? 0}／${progress.totalTopics} 個主題 · ${questions} 題`
                                          : topics || questions
                                            ? `AI 結構分析：${topics} ${isProblemSolvingResource(resource) ? "個主題" : "章"} · ${questions} 題`
                                            : "AI 結構分析：尚未整理出章／題；不影響已完成的全文與向量搜尋";
                                      })()
                                    : "完成後會自動更新章節、題目與分類結果"}
                                </span>
                                {resource.documentPageCount ? <small>原始文件：{resource.documentPageCount} 頁</small> : null}
                                {!!resource.documentTags?.length && <small>標籤：{resource.documentTags.slice(0, 8).join("、")}</small>}
                              </div>
                            </div>
                          )}
                          <button
                            type="button"
                            className="chapter-view-open"
                            disabled={!resource.documentId || chapterViewerLoading === resource.id}
                            onClick={() => void openChapterViewer(resource)}
                          >
                            {chapterViewerLoading === resource.id ? "讀取章節中…" : "查看章節內容"}
                          </button>
                          {resource.hasStoredChapterCatalogue && Number(resource.chapterCount ?? 0) === 0 && (
                            <span className="chapter-index-complete" role="status">
                              ✓ 已沿用教材分析保存的真實內容（{resource.storedChapterCatalogueCount ?? resource.documentChapterCount ?? 0} 筆）
                            </span>
                          )}
                          <button
                            type="button"
                            className="subtitle-open"
                            disabled={!resource.documentId || chapterSourceRunning === resource.id}
                            onClick={() => void (isProblemSolvingResource(resource)
                              ? scanProblemBookPages(resource)
                              : resource.hasStoredChapterCatalogue || Number(resource.chapterCount ?? 0) > 0
                                ? enrichBookText(resource)
                                : buildBookChapters(resource))}
                          >
                            {chapterSourceRunning === resource.id
                              ? "補齊原文中…"
                              : isProblemSolvingResource(resource)
                              ? Number(resource.sourcePageCount ?? 0) > 0
                                ? "接續逐頁拆解"
                                : "開始逐頁拆解整本書"
                              : resource.hasStoredChapterCatalogue || Number(resource.chapterCount ?? 0) > 0
                                ? "補齊章節原文"
                                : "建立章節索引（一次）"}
                          </button>
                          {isProblemSolvingResource(resource) && Number(resource.chapterCount ?? 0) > 0 && (
                            <button
                              type="button"
                              className="chapter-view-open"
                              disabled={!resource.documentId || chapterSourceRunning === resource.id}
                              onClick={() => void scanProblemBookPages(resource)}
                            >
                              重新檢查未處理頁
                            </button>
                          )}
                          {(resource.hasStoredChapterCatalogue || Number(resource.chapterCount ?? 0) > 0) && (() => {
                            const published = Number(resource.chapterCount ?? 0);
                            const pending = Number(resource.pendingChapterCount ?? 0);
                            const total = Math.max(published + pending, Number(resource.storedChapterCatalogueCount ?? 0));
                            const ready = Math.min(total, Number(resource.chapterSourceReadyCount ?? 0));
                            const percent = total ? Math.round((ready / total) * 100) : 0;
                            return (
                              <div className={`chapter-progress-panel ${ready === total && total > 0 ? "completed" : chapterSourceRunning === resource.id ? "building" : "not_started"}`} role="status">
                                <div className="chapter-progress-heading">
                                  <strong>{isProblemSolvingResource(resource) ? "題目與解析全文" : "章節原文"} {ready}／{total}</strong>
                                  <span>{percent}%</span>
                                </div>
                                <div className="chapter-progress-track"><i style={{ width: `${percent}%` }} /></div>
                                <div className="chapter-progress-meta">
                                  <span>{isProblemSolvingResource(resource) ? `正式 ${published} 題 · 待補 ${pending} 題` : resource.sourcePageCount ? `已直接讀取原始 PDF ${resource.sourcePageCount} 頁` : "尚未逐頁讀取原始教材"}</span>
                                  <small>{isProblemSolvingResource(resource) && chapterProgress[resource.id]?.pageCoverage
                                    ? `頁面覆蓋：已掃描 ${chapterProgress[resource.id].pageCoverage!.scanned} · 續頁 ${chapterProgress[resource.id].pageCoverage!.continuation} · 空白 ${chapterProgress[resource.id].pageCoverage!.empty} · 未處理 ${chapterProgress[resource.id].pageCoverage!.unprocessed}`
                                    : ready === total && total > 0 ? "智能書可直接引用已保存原文" : pending > 0 ? "找到下一題邊界後會自動轉為正式題型" : "按下後會逐批保存，可中斷後接續"}</small>
                                </div>
                              </div>
                            );
                          })()}
                          {isProblemSolvingResource(resource) && Number(resource.chapterCount ?? 0) === 0 && (() => {
                            const progress = chapterProgress[resource.id];
                            const percent = chapterProgressPercent(progress);
                            return (
                              <div className={`chapter-progress-panel ${progress?.state ?? "not_started"}`} role="status">
                                <div className="chapter-progress-heading">
                                  <strong>{chapterProgressLabel(progress)}</strong>
                                  <span>{percent}%</span>
                                </div>
                                <div className="chapter-progress-track"><i style={{ width: `${percent}%` }} /></div>
                                <div className="chapter-progress-meta">
                                  <span>
                                    {progress?.totalTopics
                                      ? `主題 ${progress.completedTopics ?? 0}／${progress.totalTopics}`
                                      : "等待解析工作開始"}
                                    {` · 已找到 ${progress?.foundQuestions ?? 0} 題`}
                                  </span>
                                  {progress?.currentTopic && <small>目前：{progress.currentTopic}</small>}
                                </div>
                                {progress?.error && <small className="chapter-progress-error">{progress.error}</small>}
                              </div>
                            );
                          })()}
                          {Number(resource.chapterCount ?? 0) > 0 && !isProblemSolvingResource(resource) && (
                            <>
                              <span className="chapter-index-complete" role="status">
                                ✓ 已建立章節索引（{Number(resource.chapterCount)} 筆）
                              </span>
                              <button
                                type="button"
                                className="chapter-view-open"
                                disabled={!resource.documentId || chapterBuildRunningRef.current.has(resource.id)}
                                onClick={() => void buildBookChapters(resource, true)}
                              >
                                重新細分章節索引
                              </button>
                            </>
                          )}
                            </div>
                          </details>
                        </>
                      )}
                      {resource.resourceType === "course" && (
                        <select
                          aria-label={`${resource.title}綁定書籍`}
                          value={resource.linkedBookId ?? ""}
                          onChange={(e) =>
                            bindCourseBook(resource, e.target.value)
                          }
                        >
                          <option value="">選擇這堂課對應的書</option>
                          {orderedResourceGroup("book").map((book) => (
                              <option key={book.id} value={book.id}>
                                {book.title}
                              </option>
                            ))}
                        </select>
                      )}
                      <label>
                        上傳書封
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) =>
                            uploadResourceAsset(
                              resource.id,
                              "cover",
                              e.target.files?.[0],
                            )
                          }
                        />
                      </label>
                      {resource.resourceType === "course" && (
                        <>
                          <button
                            type="button"
                            className="course-preview-open"
                            onClick={() => void openCoursePreview(resource)}
                          >
                            預覽課程
                          </button>
                          <label>
                            上傳 SRT
                            <input
                              type="file"
                              accept=".srt"
                              hidden
                              onChange={(e) =>
                                uploadResourceAsset(
                                  resource.id,
                                  "subtitle",
                                  e.target.files?.[0],
                                )
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="subtitle-open"
                            onClick={() => openSubtitleEditor(resource)}
                          >
                            校正字幕／重點
                          </button>
                          <button
                            type="button"
                            className="subtitle-repair"
                            onClick={() => repairResourceSubtitles(resource.id)}
                          >
                            重新整理字幕
                          </button>
                        </>
                      )}
                      <div className="resource-edit-actions">
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
                ))}
            </div>
          </section>
        )}
        {activeTab === "listening" && (
          <section className="panel listening-manager">
            <div className="cost-heading">
              <div>
                <h2>解題書用聽的</h2>
                <p className="panel-sub">
                  AI 生成聞稿後，可依序上傳多段音檔，再上傳整份或各段
                  SRT；系統會自動接成同一條時間軸。
                </p>
              </div>
              <span className="source-count">{listeningItems.length} 篇</span>
            </div>
            <form className="listening-create" onSubmit={generateListening}>
              <section className="listening-question-picker">
                <div className="listening-picker-heading">
                  <div>
                    <strong>從二試真題庫選題</strong>
                    <span>先查看題目與老師擬答，確認後再選用。</span>
                  </div>
                  {selectedListeningQuestion && (
                    <button type="button" onClick={() => setPreviewListeningQuestionId(selectedListeningQuestion.id)}>
                      查看已選內容
                    </button>
                  )}
                </div>
                <div className="listening-question-filters">
                  <label>
                    年度
                    <select value={listeningQuestionYear} onChange={(event) => { setListeningQuestionYear(event.target.value); setListeningQuestionSubject("all"); }}>
                      <option value="all">全部年度</option>
                      {listeningQuestionYears.map((year) => <option value={year} key={year}>{year} 年</option>)}
                    </select>
                  </label>
                  <label>
                    科目
                    <select value={listeningQuestionSubject} onChange={(event) => setListeningQuestionSubject(event.target.value)}>
                      <option value="all">全部科目</option>
                      {listeningQuestionSubjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}
                    </select>
                  </label>
                  <label className="listening-question-search">
                    搜尋
                    <input value={listeningQuestionSearch} onChange={(event) => setListeningQuestionSearch(event.target.value)} placeholder="搜尋題號、關鍵字或爭點" />
                  </label>
                </div>
                {selectedListeningQuestion && (
                  <div className="listening-selected-question">
                    <span>已選題目</span>
                    <strong>{selectedListeningQuestion.year} · {selectedListeningQuestion.subject} · 第 {selectedListeningQuestion.questionNumber} 題</strong>
                    <button type="button" onClick={() => setListeningQuestionId("")}>取消選用</button>
                  </div>
                )}
                <div className="listening-question-results">
                  {filteredListeningQuestions.length ? filteredListeningQuestions.slice(0, 40).map((question) => (
                    <button type="button" key={question.id} className={String(question.id) === listeningQuestionId ? "selected" : ""} onClick={() => setPreviewListeningQuestionId(question.id)}>
                      <span>{question.year} · {question.subject}</span>
                      <strong>第 {question.questionNumber} 題｜{question.stem.replace(/\s+/g, " ").slice(0, 72)}{question.stem.length > 72 ? "…" : ""}</strong>
                      <small>{question.hasTeacherAnswer?.trim() ? "老師擬答已核對" : "尚無老師擬答"}　點標題查看內容</small>
                    </button>
                  )) : <p>找不到符合條件的二試題目。</p>}
                </div>
              </section>
              <label className="field">
                節目標題（可由 AI 產生）
                <input
                  value={listeningTitle}
                  onChange={(e) => setListeningTitle(e.target.value)}
                  placeholder="例如：刑法二試｜共同正犯與因果歷程"
                />
              </label>
              <label className="field listening-question">
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
