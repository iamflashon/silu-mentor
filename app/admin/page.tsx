"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { unzipSync } from "fflate";

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
  hasCover: number;
  segmentCount: number;
};
type SubtitleSegment = {
  id: number;
  startSeconds: number;
  endSeconds: number;
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
  startSeconds: number;
  endSeconds: number;
  text: string;
  sequence: number;
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
};
type EssayQuestion = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  sourceUrl: string;
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
};
type JudicialStatus = {
  configured: boolean;
  caseCount: number;
  settings: Record<string, string>;
};
const DOCUMENTS_PER_PAGE = 5;
const USAGE_PER_PAGE = 10;

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (response.status === 413)
      return { error: "檔案超過單次上傳限制，請重新選擇文件" };
    return { error: "伺服器暫時無法處理這份文件" };
  }
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<
    | "documents"
    | "resources"
    | "courses"
    | "listening"
    | "magazine"
    | "legal"
    | "judicial"
    | "sources"
    | "questions"
    | "costs"
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
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceDocumentId, setResourceDocumentId] = useState("");
  const [magazineUrl, setMagazineUrl] = useState(
    "https://www.angle.com.tw/magazine/m_search.asp?KindID=12",
  );
  const [subtitleCourse, setSubtitleCourse] = useState<LearningResource | null>(
    null,
  );
  const [subtitleSegments, setSubtitleSegments] = useState<SubtitleSegment[]>(
    [],
  );
  const [segmentPage, setSegmentPage] = useState(1);
  const [analyzingSegments, setAnalyzingSegments] = useState(false);
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
  const [questionTotal, setQuestionTotal] = useState(0);
  const [questionTotals, setQuestionTotals] = useState<Record<string, number>>(
    {},
  );
  const [legalSources, setLegalSources] = useState<LegalSource[]>([]);
  const [syncingLegal, setSyncingLegal] = useState<string | null>(null);
  const [legalZipFiles, setLegalZipFiles] = useState<Record<string, File | null>>({});
  const [uploadingLegalZip, setUploadingLegalZip] = useState<string | null>(null);
  const [judicialStatus, setJudicialStatus] = useState<JudicialStatus | null>(
    null,
  );
  const [syncingJudicial, setSyncingJudicial] = useState(false);

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
        if (response.ok)
          setResources(
            ((await response.json()) as { resources?: LearningResource[] })
              .resources ?? [],
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
        if (response.ok)
          setLegalSources(
            ((await response.json()) as { sources?: LegalSource[] }).sources ??
              [],
          );
      })
      .catch(() => undefined);
    fetch("/api/judicial-sync")
      .then(async (response) => {
        if (response.ok)
          setJudicialStatus((await response.json()) as JudicialStatus);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeTab === "questions") loadExamQuestions(questionPage);
  }, [activeTab, questionPage]);

  async function syncLegal(sourceKey: string, restart = false) {
    setSyncingLegal(sourceKey);
    setNotice("正在下載官方資料並分批建立法規索引…");
    const response = await fetch("/api/legal-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceKey, restart }),
    });
    const result = (await readJson(response)) as {
      status?: string;
      processed?: number;
      next?: number;
      total?: number;
      error?: string;
    };
    setNotice(
      response.ok
        ? `本批完成 ${result.processed ?? 0} 筆；${result.status === "ready" ? "資料已可供 AI 搜尋" : `進度 ${result.next ?? 0} / ${result.total ?? 0}，請繼續下一批`}`
        : (result.error ?? "資料同步失敗"),
    );
    const refreshed = await fetch("/api/legal-sources");
    if (refreshed.ok)
      setLegalSources(
        ((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? [],
      );
    setSyncingLegal(null);
  }

  async function importAllLegal(sourceKey: string, restart = false) {
    setSyncingLegal(sourceKey);
    let nextRestart = restart;
    let completed = false;
    for (let attempt = 0; attempt < 600; attempt++) {
      const response = await fetch("/api/legal-sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKey, restart: nextRestart }),
      });
      const result = (await readJson(response)) as {
        status?: string;
        processed?: number;
        next?: number;
        total?: number;
        error?: string;
      };
      if (!response.ok) {
        setNotice(result.error ?? "資料匯入失敗，已停在目前進度");
        break;
      }
      setNotice(
        `正在分批分類 ${sourceKey === "moj-laws" ? "法律" : "命令"}：${result.next ?? 0} / ${result.total ?? 0}`,
      );
      if (result.status === "ready") {
        completed = true;
        setNotice(`已完成 ${result.total ?? 0} 部${sourceKey === "moj-laws" ? "法律" : "命令"}，條文已可供 AI 導師搜尋`);
        break;
      }
      nextRestart = false;
    }
    if (!completed && syncingLegal === sourceKey)
      setNotice((current) => current || "已完成可處理批次，請稍後繼續");
    const refreshed = await fetch("/api/legal-sources");
    if (refreshed.ok)
      setLegalSources(
        ((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? [],
      );
    setSyncingLegal(null);
  }

  async function uploadLegalZip(sourceKey: string) {
    const file = legalZipFiles[sourceKey];
    if (!file) {
      setNotice("請先選擇官方法規 ZIP 檔案");
      return;
    }
    setUploadingLegalZip(sourceKey);
    setNotice("正在保存 ZIP，完成後會自動分批分類法規與條文…");
    const form = new FormData();
    form.append("sourceKey", sourceKey);
    form.append("file", file);
    const response = await fetch("/api/legal-sources/upload", {
      method: "POST",
      body: form,
    });
    const result = (await readJson(response)) as { error?: string; sourceKeys?: string[] };
    setUploadingLegalZip(null);
    if (!response.ok) {
      setNotice(result.error ?? "ZIP 上傳失敗");
      return;
    }
    setLegalZipFiles((current) => ({ ...current, [sourceKey]: null }));
    await fetch("/api/legal-sources").then(async (refreshed) => {
      if (refreshed.ok)
        setLegalSources(
          ((await refreshed.json()) as { sources?: LegalSource[] }).sources ?? [],
        );
    });
    for (const targetKey of result.sourceKeys ?? [sourceKey])
      await importAllLegal(targetKey);
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
        : activeTab === "resources"
          ? "book"
          : resourceType;
    const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: selectedType,
        title: resourceTitle,
        subject: "刑法",
        creator: resourceCreator,
        sourceUrl: resourceUrl,
        documentId: resourceDocumentId || null,
        accessType: selectedType === "course" ? "full" : "owned",
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
        : `整份 SRT 已建立 ${result.cues ?? 0} 段字幕。`,
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
    const response = await fetch(
      `/api/exam-questions?page=${page}&status=draft`,
    );
    if (!response.ok) return;
    const result = (await response.json()) as {
      items?: ExamQuestion[];
      total?: number;
      totals?: Record<string, number>;
    };
    setExamQuestions(result.items ?? []);
    setQuestionTotal(result.total ?? 0);
    setQuestionTotals(result.totals ?? {});
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
    setNotice(`已發布 ${result.updated ?? 0} 題，前台練真題現在可直接讀取。`);
    await loadExamQuestions(questionPage);
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
    setNotice(
      assetType === "cover"
        ? "書封已更新。"
        : `字幕已完成，建立 ${result.segments ?? 0} 個可搜尋時間片段。`,
    );
  }

  async function analyzeMagazine() {
    setNotice("正在分析最新一期、試讀文章與可用連結…");
    const response = await fetch("/api/resources/magazine-import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: magazineUrl }),
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
      return;
    }
    setResources((current) =>
      current.some((item) => item.id === result.resource!.id)
        ? current
        : [result.resource!, ...current],
    );
    setNotice(
      `已分析 ${result.articles ?? 0} 個試讀入口，${result.indexed ?? 0} 篇 PDF 已完成解析並可供 AI 搜尋${result.failures?.length ? `；${result.failures.length} 篇暫時失敗，可再次按「自動分析」重試` : ""}。`,
    );
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

  async function editResource(resource: LearningResource) {
    const title = window.prompt("資源名稱", resource.title);
    if (title === null || !title.trim()) return;
    const creator = window.prompt("作者／老師／出版單位", resource.creator);
    if (creator === null) return;
    const sourceUrl = window.prompt(
      "來源網址（書籍可留空）",
      resource.sourceUrl,
    );
    if (sourceUrl === null) return;
    const response = await fetch("/api/resources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...resource, title, creator, sourceUrl }),
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
        item.id === resource.id ? { ...item, ...result.resource } : item,
      ),
    );
    setNotice("資源資料已更新。");
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

  async function openSubtitleEditor(resource: LearningResource) {
    const response = await fetch(
      `/api/resources/segments?resourceId=${resource.id}`,
    );
    const result = (await response.json()) as { segments?: SubtitleSegment[] };
    setSubtitleCourse(resource);
    setSubtitleSegments(result.segments ?? []);
    setSegmentPage(1);
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
      body: JSON.stringify({ resourceId: subtitleCourse.id }),
    });
    const result = (await readJson(response)) as {
      analyzed?: number;
      error?: string;
    };
    if (!response.ok) setNotice(result.error ?? "AI 重點分析失敗");
    else {
      setNotice(`AI 已分析 ${result.analyzed ?? 0} 個字幕片段。`);
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
        <Link href="/" className="brand">
          <span className="brand-mark">律</span>
          <span>司律導師</span>
        </Link>
        <Link href="/" className="back-link">
          返回對話首頁 →
        </Link>
      </header>
      <div className="admin-main">
        <div className="admin-title">
          <div>
            <p>MANAGEMENT WORKSPACE</p>
            <h1>司律導師管理後台</h1>
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
            影音／試聽課
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
            真題審核
          </button>
          <button
            className={activeTab === "costs" ? "active" : ""}
            onClick={() => setActiveTab("costs")}
          >
            模型與成本
          </button>
        </nav>
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
                PDF 將自動解析、切分並建立搜尋索引，供司律導師回答與教學。
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
        {(activeTab === "resources" || activeTab === "courses") && (
          <section className="panel resource-manager">
            <div className="cost-heading">
              <div>
                <h2>書籍與課程管理</h2>
                <p className="panel-sub">
                  書籍綁定教材 PDF 並管理書封；課程綁定網址與 SRT
                  字幕，字幕會自動拆成可搜尋的時間片段。
                </p>
              </div>
              <span className="source-count">{resources.length} 項資源</span>
            </div>
            <form className="resource-form" onSubmit={addResource}>
              <label className="field">
                資源類型
                <select
                  value={activeTab === "courses" ? "course" : "book"}
                  onChange={(e) => setResourceType(e.target.value)}
                  disabled
                >
                  <option value="book">書籍</option>
                  <option value="course">影音課程</option>
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
              {activeTab === "courses" ? (
                <label className="field">
                  課程／來源網址
                  <input
                    type="url"
                    value={resourceUrl}
                    onChange={(e) => setResourceUrl(e.target.value)}
                    placeholder="https://…"
                  />
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
              {resources
                .filter((resource) =>
                  activeTab === "courses"
                    ? resource.resourceType === "course"
                    : resource.resourceType === "book",
                )
                .map((resource) => (
                  <article className="resource-card" key={resource.id}>
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
                        {resource.documentId
                          ? "已綁定教材 PDF"
                          : resource.sourceUrl
                            ? "已設定來源網址"
                            : "尚未綁定內容"}{" "}
                        · {resource.segmentCount} 個學習片段
                      </small>
                    </div>
                    <div className="resource-actions">
                      {resource.resourceType === "book" && (
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
                          {resources
                            .filter((item) => item.resourceType === "book")
                            .map((book) => (
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
                      {question.questionNumber} 題
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
                  貼入歷期網址後，自動找到最新一期並分析出刊資料、試讀文章與合法連結；資料先進草稿，確認後再供前台推薦。
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
              <button
                type="button"
                className="primary-btn"
                onClick={analyzeMagazine}
              >
                自動分析最新一期
              </button>
            </div>
            {notice && <div className="notice">{notice}</div>}
            <div className="resource-grid">
              {resources
                .filter((item) => item.resourceType === "magazine")
                .map((resource) => (
                  <article className="resource-card" key={resource.id}>
                    <div className="resource-cover">
                      <span>刊</span>
                    </div>
                    <div className="resource-info">
                      <span>
                        {resource.status === "draft" ? "待確認" : "前台顯示"}
                      </span>
                      <h3>{resource.title}</h3>
                      <p>{resource.creator}</p>
                      <small>
                        {resource.description || "尚未取得出刊資料"} ·{" "}
                        {resource.segmentCount} 篇內容
                      </small>
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
                    <button onClick={() => publishQuestions([question.id])}>
                      發布前台
                    </button>
                  </footer>
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
                <iframe
                  src={subtitleCourse.sourceUrl}
                  title={`${subtitleCourse.title}課程畫面`}
                />
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
                    : "AI 自動拆解推薦重點"}
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
                        <a
                          href={`${subtitleCourse.sourceUrl}#t=${segment.startSeconds}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          跳到此段
                        </a>
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
                每個官方來源獨立下載與管理；完成解析後才供 AI 導師引用。
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
                  {source.sourceKey.startsWith("moj-")
                    ? "法務部官方開放資料，每月更新"
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
                {source.lastError && (
                  <small className="data-error">{source.lastError}</small>
                )}
                {source.sourceKey.startsWith("moj-") && (
                  <div className="legal-zip-upload">
                    <label>
                      <span>
                        {legalZipFiles[source.sourceKey]?.name ??
                          "選擇官方法規 ZIP（可取代目前資料）"}
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
                  <button
                    disabled={syncingLegal !== null}
                    onClick={() =>
                      source.sourceKey.startsWith("moj-")
                        ? importAllLegal(source.sourceKey, source.status === "ready")
                        : syncLegal(source.sourceKey, source.status === "ready")
                    }
                  >
                    {syncingLegal === source.sourceKey
                      ? "處理中…"
                      : source.status === "uploaded"
                        ? "開始自動匯入"
                      : source.status === "importing"
                        ? "繼續自動匯入"
                        : source.status === "ready"
                          ? "重新同步"
                          : source.sourceKey.startsWith("moj-")
                            ? "開始下載並匯入"
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
              <span>今晚排程</span>
              <strong>00:30</strong>
              <small>官方服務時間內執行</small>
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
