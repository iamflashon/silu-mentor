"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { unzip, unzipSync } from "fflate";
import { formatMagazineAnalysis, parseMagazineAnalysis } from "../../lib/magazine";
import { collectLawObjects, compactLegalRecord, legalCategory, parseLegalXml, type LegalArchiveEntry } from "../../lib/legal-parser";
import CourseVideoPlayer, { formatMediaTime } from "../course-video-player";

type Uploaded = {
  id: number;
  name: string;
  subject: string;
  size: string;
  status: string;
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
  showCosts: boolean;
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
  indexedBytes: number;
  citations: number;
  misses: number;
  indexVersion: string;
};
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
  articleCount?: number;
  analyzedArticleCount?: number;
  failedArticleCount?: number;
  pendingArticleCount?: number;
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

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<
    | "documents"
    | "resources"
    | "courses"
    | "trials"
    | "listening"
    | "magazine"
    | "legal"
    | "judicial"
    | "sources"
    | "questions"
    | "costs"
    | "homepage"
  >("documents");
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [subject, setSubject] = useState("刑法");
  const [type, setType] = useState("教科書");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentStats, setDocumentStats] = useState<DocumentStats>({
    total: 0,
    ready: 0,
    indexedBytes: 0,
    citations: 0,
    misses: 0,
    indexVersion: "待建立",
  });
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
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
  const [listeningTitle, setListeningTitle] = useState("");
  const [listeningQuestionText, setListeningQuestionText] = useState("");
  const [listeningFile, setListeningFile] = useState<File | null>(null);
  const [listeningPackageFile, setListeningPackageFile] = useState<File | null>(
    null,
  );
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
  const [focusMusicUrl, setFocusMusicUrl] = useState("");
  const [focusMusicDraft, setFocusMusicDraft] = useState("");
  const [savingFocusMusic, setSavingFocusMusic] = useState(false);

  useEffect(() => {
    fetch("/api/documents")
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as {
          documents?: Array<{
            id: number;
            name: string;
            subject: string;
            type: string;
            sizeBytes: number;
            status: string;
            error?: string | null;
          }>;
          stats?: DocumentStats;
        };
        setFiles(
          (result.documents ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            subject: item.subject,
            size: `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${item.type}`,
            status: item.status,
            error: item.error,
          })),
        );
        if (result.stats) setDocumentStats(result.stats);
      })
      .catch(() => undefined);
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
        // 修復早期版本把整段 SRT 當成一筆文字保存的舊資料。
        await Promise.all(
          loaded
            .filter((item) => item.resourceType === "course" && item.segmentCount > 0)
            .map((item) => repairResourceSubtitles(item.id, true)),
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
        const result = (await response.json()) as { focusMusicUrl?: string };
        setFocusMusicUrl(result.focusMusicUrl ?? "");
        setFocusMusicDraft(result.focusMusicUrl ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function saveFocusMusic(event: FormEvent) {
    event.preventDefault();
    setSavingFocusMusic(true);
    const response = await fetch("/api/site-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ focusMusicUrl: focusMusicDraft }) });
    const result = (await readJson(response)) as { focusMusicUrl?: string; error?: string };
    if (response.ok) { setFocusMusicUrl(result.focusMusicUrl ?? ""); setFocusMusicDraft(result.focusMusicUrl ?? ""); setNotice(result.focusMusicUrl ? "讀書音樂已設定，前台現在可以播放。" : "前台讀書音樂已清除。"); }
    else setNotice(result.error ?? "讀書音樂設定失敗");
    setSavingFocusMusic(false);
  }

  useEffect(() => {
    if (activeTab === "questions") loadExamQuestions(questionPage);
  }, [activeTab, questionPage, questionExamType, questionStatus, questionYear, questionSubject]);

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
      body: JSON.stringify({ action, limit: 30 }),
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
    const params = new URLSearchParams({ page: String(page), status: questionStatus, examType: questionExamType });
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
        all ? { publishAllDrafts: true } : { ids, status: "published" },
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
      `${resource.title} 已${documentId ? "綁定教材 PDF" : "解除教材綁定"}。`,
    );
  }

  async function buildBookChapters(resource: LearningResource) {
    if (!resource.documentId) {
      setNotice("請先替這本書綁定已完成索引的教材 PDF。");
      return;
    }
    setNotice(`正在從「${resource.title}」已建立的教材索引整理章節；不會重新上傳或讀取整份 PDF…`);
    const response = await fetch("/api/resources/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId: resource.id }),
    });
    const result = (await readJson(response)) as {
      chapters?: unknown[];
      generated?: boolean;
      reused?: boolean;
      error?: string;
    };
    if (!response.ok) {
      setNotice(result.error ?? "章節索引建立失敗；教材本身不會被重新拆解。");
      return;
    }
    const count = result.chapters?.length ?? 0;
    setResources((current) => current.map((item) => item.id === resource.id ? { ...item, chapterCount: count } : item));
    setNotice(result.reused
      ? `「${resource.title}」已建立好章節索引，共 ${count} 章；這次沒有再次呼叫 AI。`
      : `「${resource.title}」已建立好章節索引，共 ${count} 章；之後前台會直接讀取已保存內容。`);
  }

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
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1${startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : ""}` : "";
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

  async function runExamSourceStep(sourceId: number) {
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
      body: JSON.stringify({ sourceId }),
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
    if (response.ok) setUsage({ ...usage, showCosts: next });
  }

  async function startIndex(documentId: number) {
    setFiles((current) =>
      current.map((item) =>
        item.id === documentId
          ? { ...item, status: "uploading_to_index", error: null }
          : item,
      ),
    );
    setNotice("正在把 PDF 送入教材索引服務…");
    try {
      const response = await fetch("/api/documents/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const result = (await readJson(response)) as {
        status?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "建立索引失敗");
      setFiles((current) =>
        current.map((item) =>
          item.id === documentId
            ? { ...item, status: result.status ?? "in_progress" }
            : item,
        ),
      );
      setNotice("索引服務已接收文件，完成後會自動改為「可供搜尋」。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "建立索引失敗";
      setFiles((current) =>
        current.map((item) =>
          item.id === documentId
            ? { ...item, status: "failed", error: message }
            : item,
        ),
      );
      setNotice(message);
    }
  }

  function chooseFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    const pdfs = incoming.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    const rejected = incoming.length - pdfs.length;
    setQueue((current) => {
      const known = new Set(
        current.map(
          (item) =>
            `${item.file.name}-${item.file.size}-${item.file.lastModified}`,
        ),
      );
      const additions = pdfs
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
      pdfs.length
        ? `已加入 ${pdfs.length} 份 PDF${rejected ? `，另排除 ${rejected} 個非 PDF 檔案` : ""}。確認科目與類型後即可依序上傳。`
        : "拖入的檔案沒有 PDF，請重新選擇。",
    );
  }

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function uploadOne(item: QueueItem, position: number, total: number) {
    const selected = item.file;
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
        contentType: "application/pdf",
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
        contentType: "application/pdf",
        sizeBytes: selected.size,
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
        subject,
        size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${type}`,
        status: "uploaded",
      },
      ...current,
    ]);
    setDocumentPage(1);
    patchQueue(item.key, { status: "indexing", progress: 92 });

    const indexResponse = await fetch("/api/documents/index", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: newId }),
    });
    const indexed = (await readJson(indexResponse)) as {
      status?: string;
      error?: string;
    };
    if (!indexResponse.ok) throw new Error(indexed.error ?? "建立索引失敗");
    setFiles((current) =>
      current.map((file) =>
        file.id === newId
          ? { ...file, status: indexed.status ?? "in_progress" }
          : file,
      ),
    );
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
  }

  const documentPageCount = Math.max(
    1,
    Math.ceil(files.length / DOCUMENTS_PER_PAGE),
  );
  const visibleFiles = files.slice(
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

  return (
    <main className="admin-shell">
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-mark">律</span>
          <span>司律備考</span>
        </a>
        <a href="/" className="back-link">
          返回對話首頁 →
        </a>
      </header>
      <div className="admin-main">
        <div className="admin-title">
          <div>
            <p>MANAGEMENT WORKSPACE</p>
            <h1>司律備考管理後台</h1>
          </div>
        </div>
        <nav className="admin-tabs" aria-label="後台功能切換">
          <button
            className={activeTab === "documents" ? "active" : ""}
            onClick={() => setActiveTab("documents")}
          >
            教材知識庫
          </button>
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
          <button
            className={activeTab === "costs" ? "active" : ""}
            onClick={() => setActiveTab("costs")}
          >
            模型與成本
          </button>
          <button
            className={activeTab === "homepage" ? "active" : ""}
            onClick={() => setActiveTab("homepage")}
          >
            首頁與播放
          </button>
        </nav>
        {activeTab === "homepage" && (
          <section className="panel site-settings-panel">
            <div className="cost-heading">
              <div>
                <h2>首頁與播放設定</h2>
                <p className="panel-sub">在後台設定一支 YouTube 無版權／創作者授權音樂，前台首頁與學習專區會顯示播放器。</p>
              </div>
              <span className={`source-count ${focusMusicUrl ? "configured" : ""}`}>{focusMusicUrl ? "已設定" : "尚未設定"}</span>
            </div>
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
        {activeTab === "costs" && (
          <section className="cost-panel panel">
            <div className="cost-heading">
              <div>
                <h2>AI 使用成本</h2>
                <p className="panel-sub">
                  依實際 API usage 記錄，供未來方案與收費評估。
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
                  )}
                </strong>
              </div>
            </div>
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
                            )}
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
          <div className="admin-grid">
            <form className="panel" onSubmit={submit}>
              <h2>上傳教材</h2>
              <p className="panel-sub">
                PDF 將自動解析、切分並建立搜尋索引，供司律備考回答與教學。
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
                  accept="application/pdf"
                  multiple
                  hidden
                  onChange={(e) => chooseFiles(e.target.files)}
                />
                <span className="upload-icon">＋</span>
                <strong>
                  {dragActive
                    ? "放開滑鼠，加入批次佇列"
                    : queue.length
                      ? `已選擇 ${queue.length} 份 PDF`
                      : "拖曳大量 PDF 到這裡"}
                </strong>
                <span>
                  {queue.length
                    ? `共 ${(queue.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(1)} MB · 還可以繼續拖入更多檔案`
                    : "或點此批次選取；系統將逐本上傳與建立索引"}
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
                                  ? "送入索引中"
                                  : item.status === "done"
                                    ? "已送出索引"
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
                  科目
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  >
                    <option>刑法</option>
                    <option>刑事訴訟法</option>
                    <option>民法</option>
                    <option>民事訴訟法</option>
                    <option>憲法</option>
                    <option>行政法</option>
                    <option>商事法</option>
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
                    : `依序上傳 ${queue.length || ""} 份並建立索引`}
              </button>
              {notice && <div className="notice">{notice}</div>}
            </form>
            <section className="panel document-panel">
              <h2>文件處理狀態</h2>
              <p className="panel-sub">
                只有完成索引的內容，才會進入教材優先檢索。
              </p>
              {files.length === 0 ? (
                <div className="empty-state">
                  尚未上傳教材
                  <br />
                  第一份 PDF 會顯示在這裡
                </div>
              ) : (
                <div className="file-list">
                  {visibleFiles.map((file) => {
                    const ready = file.status === "completed";
                    const failed = file.status === "failed";
                    const waiting = file.status === "uploaded";
                    return (
                      <div className="file-card" key={file.id}>
                        <span className="file-type">PDF</span>
                        <div className="file-info">
                          <strong>{file.name}</strong>
                          <span>
                            {file.subject} · {file.size}
                            {file.error ? ` · ${file.error}` : ""}
                          </span>
                        </div>
                        {waiting || failed ? (
                          <button
                            className="index-btn"
                            onClick={() => startIndex(file.id)}
                          >
                            {failed ? "重新索引" : "開始索引"}
                          </button>
                        ) : (
                          <span className={`status ${ready ? "" : "pending"}`}>
                            {ready ? "可供搜尋" : "建立索引中"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="index-metrics" aria-label="教材索引即時統計">
                <div>
                  <span>可搜尋</span>
                  <strong>
                    {documentStats.ready} / {documentStats.total}
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
              {files.length > DOCUMENTS_PER_PAGE && (
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
          </div>
        )}
        {(activeTab === "resources" || activeTab === "courses" || activeTab === "trials") && (
          <section className="panel resource-manager">
            <div className="cost-heading">
              <div>
                <h2>{activeTab === "trials" ? "知識達試聽管理" : "書籍與課程管理"}</h2>
                <p className="panel-sub">
                  {activeTab === "trials" ? "新增老師、科目、課程簡介與知識達官方試聽連結；前台只提供外部入口，不搬動或播放影片。" : "書籍綁定教材 PDF 並管理書封；課程綁定可直接播放的 HLS／影片網址與 SRT 字幕，字幕會自動拆成可搜尋的時間片段。"}
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
                    placeholder={activeTab === "trials" ? "https://www.ibrain.com.tw/audition/ListDetail.aspx?…" : "https://…/playlist.m3u8"}
                  />
                  <small className="field-hint">{activeTab === "trials" ? "學生點擊後會另開此官方頁面。" : "請填可直接播放的 .m3u8 或 .mp4；ibrain 課程頁網址不能直接嵌入。"}</small>
                </label>
              ) : (
                <div className="field resource-create-hint">
                  <span>教材 PDF</span>
                  <strong>建立後在書卡上選擇</strong>
                </div>
              )}
              <button className="primary-btn" disabled={!resourceTitle.trim()}>
                建立資源
              </button>
            </form>
            {notice && <div className="notice">{notice}</div>}
            <div className="resource-grid">
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
                            ? "已綁定教材 PDF，AI 將從文件索引搜尋"
                            : "尚未綁定教材 PDF"
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
                          <select
                            aria-label={`${resource.title}綁定教材 PDF`}
                            value={resource.documentId ?? ""}
                            onChange={(e) =>
                              bindBookDocument(resource, e.target.value)
                            }
                          >
                            <option value="">選擇教材 PDF</option>
                            {files.map((file) => (
                              <option key={file.id} value={file.id}>
                                {file.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="subtitle-open"
                            disabled={!resource.documentId || Number(resource.chapterCount ?? 0) > 0}
                            onClick={() => void buildBookChapters(resource)}
                          >
                            {Number(resource.chapterCount ?? 0) > 0 ? "已建立好章節索引" : "建立章節索引（一次）"}
                          </button>
                          {Number(resource.chapterCount ?? 0) > 0 && (
                            <span className="chapter-index-complete" role="status">
                              ✓ 已建立好章節索引（{Number(resource.chapterCount)} 章）
                            </span>
                          )}
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
              <label className="field">
                從二試真題庫選題
                <select
                  value={listeningQuestionId}
                  onChange={(e) => setListeningQuestionId(e.target.value)}
                >
                  <option value="">不選，改用貼上／上傳</option>
                  {essayQuestions.map((question) => (
                    <option value={question.id} key={question.id}>
                      {question.year} · {question.subject} · 第{" "}
                      {question.questionNumber} 題{question.hasTeacherAnswer?.trim() ? " · 已核對擬答" : " · 尚無擬答"}
                    </option>
                  ))}
                </select>
              </label>
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
            <div className="magazine-year-filter">
              <div><strong>依年度查看</strong><span>預設只顯示一個年度，避免所有期數一次展開。</span></div>
              <select value={magazineListYear} onChange={(event) => setMagazineListYear(Number(event.target.value))}>
                {Array.from(new Set(resources.filter((item) => item.resourceType === "magazine").map((item) => Number(item.description.match(/(20\d{2})[年/]/)?.[1])).filter(Boolean).concat([new Date().getFullYear()]))).sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year} 年</option>)}
              </select>
            </div>
            <div className="resource-grid">
              {resources
                .filter((item) => item.resourceType === "magazine")
                .filter((item) => Number(item.description.match(/(20\d{2})[年/]/)?.[1]) === magazineListYear)
                .map((resource) => (
                  <article className="resource-card" key={resource.id}>
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
                ))}
            </div>
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
              <div><span>目前分類</span><strong>{questionExamType === "mcq" ? "一試選擇題" : "二試申論題"}</strong></div>
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
                      {question.year} · {question.subject} · 第{" "}
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
              <div><span>{editingQuestion.examType === "essay" ? "二試申論題編輯" : "一試選擇題編輯"}</span><h2 id="question-editor-title">{editingQuestion.year} · {editingQuestion.subject} · 第 {editingQuestion.questionNumber} 題</h2></div>
              <button type="button" onClick={() => setEditingQuestion(null)} aria-label="關閉編輯">×</button>
            </header>
            <div className="question-editor-grid">
              <label>年度<input value={editingQuestion.year} onChange={(event) => setEditingQuestion({ ...editingQuestion, year: event.target.value })} /></label>
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
                使用已儲存帳密取得 6 小時 Token；官方 API 僅於每日 00:00 至
                06:00 開放。
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
              <strong>{judicialStatus?.schedule?.time ?? "00:30"}</strong>
              <small>{judicialStatus?.schedule?.enabled ? `每 ${judicialStatus.schedule.intervalMinutes ?? 5} 分鐘自動續傳（台灣時間）` : "尚未啟用"}</small>
            </article>
            <article>
              <span>待下載</span>
              <strong>
                {Number(
                  judicialStatus?.settings?.judicial_pending_count ?? 0,
                ).toLocaleString()}
              </strong>
              <small>每批 30 筆續傳</small>
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
                錯誤或中斷後會在 {judicialStatus.schedule.window ?? "00:30–05:55"} 每 {judicialStatus.schedule.intervalMinutes ?? 5} 分鐘自動恢復；不用整晚開著此頁面。
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
    </main>
  );
}
