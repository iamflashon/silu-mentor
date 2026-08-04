"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "../listening-player";
import CourseVideoPlayer, { formatMediaTime } from "../course-video-player";
import { PracticeLab } from "./practice-lab";
import { LegalSearch } from "./legal-search";
import { JudicialSearch } from "./judicial-search";
import { taipeiDate, taipeiMonth } from "../../lib/taipei-time";

type Plan = { id: number; title: string; targetLabel: string; dailyMinutes: number };
type Task = { id: number; planId: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type Draft = { id?: number; date: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type StudyRecord = { id: number; recordDate: string; subject: string; title: string; activityType: string; plannedMinutes: number; actualMinutes: number; correct: boolean | null; reflection: string; weakness: string; nextStep: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };
type LearningResource = { id: number; resourceType: "book" | "course" | "magazine"; title: string; subject: string; creator: string; description: string; documentId: number | null; documentStatus?: string | null; documentError?: string | null; sourceUrl: string; accessType: string; status: string; sortOrder: number; segmentCount: number; hasCover?: number };
type ResourceSegment = { id: number; resourceId: number; segmentType: string; lessonLabel: string; title: string; pageStart: number | null; pageEnd: number | null; startSeconds: number | null; endSeconds: number | null; text: string; summary: string; importance: number; recommended: boolean; sequence: number };
type TutorMessage = { role: "mentor" | "student"; text: string };
type ChatDay = { id: number; date: string; title: string; summary: string; progressStatus: string; messageCount: number; messages: Array<{ role: "mentor" | "student"; text: string; sources?: string[] }> };
type ExamCoachConversation = { questionId: number; year: string; subject: string; questionNumber: string; stem: string; messages: Array<{ id: number; role: string; text: string; createdAt: string }> };
type MagazineFeed = { id: number; title: string; sourceUrl: string; description?: string; isDraft?: boolean; articles?: Array<{ id: number; title: string; summary: string; issue: string; reviewStatus: string; sequence: number }> };
type HomeFeed = { magazines?: MagazineFeed[]; magazine: MagazineFeed | null; listeningItems?: ListeningFeed[]; listening: ListeningFeed | null; focusMusicUrl?: string };

const subjects = ["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法", "綜合"];

const planningSubjects = ["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法"];
const subjectScopes: Record<string, string[]> = {
  刑法: ["全科", "刑法總則", "刑法分則"],
  刑事訴訟法: ["全科", "偵查", "強制處分", "證據", "審判", "救濟"],
  民法: ["全科", "民法總則", "債法", "物權", "親屬", "繼承"],
  民事訴訟法: ["全科", "總則", "第一審", "證據", "上訴與抗告", "強制執行"],
  憲法: ["全科", "基本權", "權力分立", "憲法訴訟"],
  行政法: ["全科", "行政處分", "行政程序", "行政救濟", "國家責任"],
  商事法: ["全科", "公司法", "證券交易法", "保險法", "票據法"],
};
const planningGoals = ["建立體系", "學習爭點", "一試刷題", "二試申論", "考前複習"];
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
  clearScope: "all" | "subject";
  step: "settings" | "preview";
};

function monthValue(date = new Date()) {
  return taipeiMonth(date);
}

type PlanTab = "calendar" | "practice" | "laws" | "books" | "courses" | "listening" | "magazine" | "records" | "conversations" | "exam-conversations" | "notes";

function requestedPlanTab(): PlanTab {
  if (typeof window === "undefined") return "calendar";
  const value = new URLSearchParams(window.location.search).get("tab");
  return ["calendar", "practice", "laws", "books", "courses", "listening", "magazine", "records", "conversations", "exam-conversations", "notes"].includes(value ?? "")
    ? value as PlanTab
    : "calendar";
}

export default function StudyPlanPage() {
  const [month, setMonth] = useState(monthValue());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [chatDays, setChatDays] = useState<ChatDay[]>([]);
  const [examConversations, setExamConversations] = useState<ExamCoachConversation[]>([]);
  const [openExamConversation, setOpenExamConversation] = useState<number | null>(null);
  const [openChatDay, setOpenChatDay] = useState<number | null>(null);
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [notePage, setNotePage] = useState(1);
  const [noteQuery, setNoteQuery] = useState("");
  const [recordDraft, setRecordDraft] = useState({ subject: "刑法", title: "", actualMinutes: 60, weakness: "", nextStep: "" });
  const [activeTab, setActiveTab] = useState<PlanTab>(requestedPlanTab);
  const [noteDraft, setNoteDraft] = useState<SavedNote | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  const [expandedBookId, setExpandedBookId] = useState<number | null>(null);
  const [resourceSegments, setResourceSegments] = useState<ResourceSegment[]>([]);
  const [bookChapters, setBookChapters] = useState<ResourceSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [courseSeekToken, setCourseSeekToken] = useState(0);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [bookMessages, setBookMessages] = useState<TutorMessage[]>([]);
  const [bookInput, setBookInput] = useState("");
  const [bookChatLoading, setBookChatLoading] = useState(false);
  const [bookChaptersLoading, setBookChaptersLoading] = useState(false);
  const [bookChapterMessage, setBookChapterMessage] = useState("");
  const chapterBuildAttemptedRef = useRef<Set<number>>(new Set());
  const bookDialogueEndRef = useRef<HTMLDivElement | null>(null);
  const [resourceProgress, setResourceProgress] = useState<Record<string, { page: number; segmentId: number | null; positionSeconds: number; updatedAt: string }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("silu-resource-progress") ?? "{}"); } catch { return {}; }
  });
  const [resourceMessage, setResourceMessage] = useState("");
  const [coursePlayerError, setCoursePlayerError] = useState("");
  const [resetPlanOpen, setResetPlanOpen] = useState(false);
  const [resetPlanLoading, setResetPlanLoading] = useState(false);
  const [resetPlanMessage, setResetPlanMessage] = useState("");
  const [resetPlanDraft, setResetPlanDraft] = useState<ResetPlanDraft>({ mode: "all", subject: "民法", scope: "全科", level: "有基礎", dailyMinutes: 120, days: 14, goals: ["建立體系", "一試刷題", "二試申論"], resources: ["教材", "影音", "法條", "真題", "申論", "錯題複習"], clearScope: "all", step: "settings" });

  async function load() {
    const response = await fetch(`/api/study-plan?month=${month}`);
    if (!response.ok) return;
    const result = await response.json() as { plans: Plan[]; tasks: Task[] };
    setPlans(result.plans ?? []);
    setTasks(result.tasks ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [month]);
  useEffect(() => {
    fetch("/api/learning-records").then(async (response) => { if (response.ok) setRecords(((await response.json()) as { records?: StudyRecord[] }).records ?? []); });
    fetch("/api/chat/history?archive=1").then(async (response) => { if (response.ok) setChatDays(((await response.json()) as { archive?: ChatDay[] }).archive ?? []); });
    fetch("/api/exam-coach-history").then(async (response) => { if (response.ok) setExamConversations(((await response.json()) as { conversations?: ExamCoachConversation[] }).conversations ?? []); });
    fetch("/api/notes").then(async (response) => { if (response.ok) setNotes(((await response.json()) as { notes?: SavedNote[] }).notes ?? []); });
    fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed((await response.json()) as HomeFeed); });
    fetch("/api/resources").then(async (response) => { if (response.ok) setResources(((await response.json()) as { resources?: LearningResource[] }).resources ?? []); });
  }, []);

  useEffect(() => {
    const resource = resources.find((item) => item.id === selectedResourceId) ?? (activeTab === "courses" ? resources.find((item) => item.resourceType === "course" && item.status !== "archived") : null);
    if (!resource || resource.resourceType !== "course" || activeTab !== "courses") return;
    fetch(`/api/resources/segments?resourceId=${resource.id}&view=summary`).then(async (response) => { if (response.ok) setResourceSegments((((await response.json()) as { segments?: ResourceSegment[] }).segments ?? []).filter((segment) => segment.segmentType === "subtitle")); });
  }, [resources, selectedResourceId, activeTab]);

  async function loadBookChapters(resourceId: number, allowBuild = true) {
    setBookChapters([]);
    setBookChapterMessage("");
    setBookChaptersLoading(true);
    try {
      const response = await fetch(`/api/resources/chapters?resourceId=${resourceId}`);
      const result = await response.json() as {
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
      const canBuild = allowBuild && result.ready && (result.status === "not_started" || result.status === "failed");
      if (canBuild && !chapterBuildAttemptedRef.current.has(resourceId)) {
        chapterBuildAttemptedRef.current.add(resourceId);
        setBookChapterMessage("教材索引已完成，正在建立本書章節目錄…");
        const buildResponse = await fetch("/api/resources/chapters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resourceId }),
        });
        const buildResult = await buildResponse.json() as {
          chapters?: ResourceSegment[];
          error?: string;
          status?: string;
        };
        if (buildResult.chapters?.length) {
          setBookChapters(buildResult.chapters);
          setBookChapterMessage("");
        } else if (buildResponse.status === 202 || buildResult.status === "building") {
          setBookChapterMessage("章節目錄正在建立，完成後會自動顯示…");
          window.setTimeout(() => { void loadBookChapters(resourceId, false); }, 2500);
        } else if (!buildResponse.ok) {
          setBookChapterMessage(buildResult.error ?? "章節目錄建立失敗，請再試一次。");
        }
      } else if (result.status === "building") {
        setBookChapterMessage("章節目錄正在建立，完成後會自動顯示…");
        window.setTimeout(() => { void loadBookChapters(resourceId, false); }, 2500);
      } else if (!response.ok || !chapters.length) {
        setBookChapterMessage(result.message ?? result.error ?? "教材章節暫時無法讀取");
      }
    } catch {
      setBookChapterMessage("教材章節暫時無法讀取，請再試一次。");
    } finally {
      setBookChaptersLoading(false);
    }
  }

  useEffect(() => {
    const resource = resources.find((item) => item.id === selectedResourceId) ?? (activeTab === "books" ? resources.find((item) => item.resourceType === "book" && item.status !== "archived") : null);
    if (!resource || resource.resourceType !== "book" || activeTab !== "books") return;
    const timer = window.setTimeout(() => { void loadBookChapters(resource.id); }, 0);
    return () => window.clearTimeout(timer);
  }, [resources, selectedResourceId, activeTab]);

  useEffect(() => {
    if (activeTab === "books") bookDialogueEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

  function dateFor(day: number) { return `${month}-${String(day).padStart(2, "0")}`; }
  function openNew(day?: number) {
    setDraft({ date: day ? dateFor(day) : `${month}-01`, subject: "刑法", title: "", durationMinutes: 60, details: "", status: "pending" });
  }
  function openTask(task: Task) {
    setDraft({ id: task.id, date: task.taskDate, subject: task.subject, title: task.title, durationMinutes: task.durationMinutes, details: task.details, status: task.status });
    const marker = task.details.match(/\[resource:(\d+)\]/)?.[1];
    const resourceId = marker ? Number(marker) : null;
    const resource = resourceId ? resources.find((item) => item.id === resourceId) : resources.find((item) => task.title.includes(item.title));
    if (resource) { setSelectedResourceId(resource.id); setSelectedSegmentId(null); setSelectedChapterId(null); setBookMessages([]); setActiveTab(resource.resourceType === "course" ? "courses" : "books"); }
  }

  async function save() {
    if (!draft?.title.trim()) { setMessage("請輸入任務名稱"); return; }
    const response = await fetch("/api/study-plan", {
      method: draft.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: draft.id, planId: plans[0]?.id, ...draft }),
    });
    if (!response.ok) { const result = await response.json() as { error?: string }; setMessage(result.error ?? "儲存失敗"); return; }
    setDraft(null); setMessage(""); await load();
  }

  async function remove() {
    if (!draft?.id) return;
    await fetch(`/api/study-plan?taskId=${draft.id}`, { method: "DELETE" });
    setDraft(null); await load();
  }

  async function toggle(task: Task) {
    await fetch("/api/study-plan", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, status: task.status === "completed" ? "pending" : "completed" }) });
    await load();
  }

  async function clearAndReplan() {
    setResetPlanLoading(true);
    setResetPlanMessage("");
    try {
      const clearOnlySubject = resetPlanDraft.mode === "single" && resetPlanDraft.clearScope === "subject";
      const target = resetPlanDraft.mode === "single" ? `${resetPlanDraft.subject}（${resetPlanDraft.scope}）單科專攻` : "司律全科備考";
      const prompt = `請立即依照我的既有學習紀錄、作答結果、弱點與目前進度，建立一份從今天開始的 ${resetPlanDraft.days} 天「${target}」讀書計畫。程度：${resetPlanDraft.level}；每日可用時間：${resetPlanDraft.dailyMinutes} 分鐘；學習目標：${resetPlanDraft.goals.join("、")}；納入資源：${resetPlanDraft.resources.join("、")}。${resetPlanDraft.mode === "single" ? `所有新任務都必須屬於「${resetPlanDraft.subject}」，並聚焦「${resetPlanDraft.scope}」。` : "請依弱點與考試重要性分配各科比重。"}避免重複已完成內容，安排間隔複習，並直接使用 save_study_plan 寫入行事曆。`;
      const planResponse = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        messages: [{ role: "student", text: prompt }],
        planningConstraint: resetPlanDraft.mode === "single" ? {
          mode: "single",
          subject: resetPlanDraft.subject,
          scope: resetPlanDraft.scope,
          replaceOnlySubject: resetPlanDraft.clearScope === "subject",
          days: resetPlanDraft.days,
          dailyMinutes: resetPlanDraft.dailyMinutes,
        } : { mode: "all", subject: "", scope: "", replaceOnlySubject: false, days: resetPlanDraft.days, dailyMinutes: resetPlanDraft.dailyMinutes },
      }) });
      const planResult = await planResponse.json() as { planSaved?: boolean; replacedTasks?: number; error?: string };
      if (!planResponse.ok || !planResult.planSaved) throw new Error(planResult.error ?? "AI 尚未成功建立新計畫，原行程未變動，請再試一次。");
      setResetPlanMessage(`已替換 ${planResult.replacedTasks ?? 0} 項${clearOnlySubject ? resetPlanDraft.subject : ""}舊行程，AI 已重新安排接下來的讀書計畫。`);
      await load();
      window.setTimeout(() => { setResetPlanOpen(false); setResetPlanMessage(""); }, 1200);
    } catch (error) {
      setResetPlanMessage(error instanceof Error ? error.message : "重新規劃失敗，請稍後再試。");
      await load();
    } finally {
      setResetPlanLoading(false);
    }
  }

  function togglePlanningItem(key: "goals" | "resources", value: string) {
    const current = resetPlanDraft[key];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    setResetPlanDraft({ ...resetPlanDraft, [key]: next });
  }

  function openResetPlanner() {
    setResetPlanDraft((current) => ({ ...current, dailyMinutes: plans[0]?.dailyMinutes ?? current.dailyMinutes, step: "settings" }));
    setResetPlanMessage("");
    setResetPlanOpen(true);
  }

  function moveMonth(delta: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    setMonth(monthValue(new Date(year, monthNumber - 1 + delta, 1)));
  }

  const filteredNotes = notes.filter((note) => !noteQuery.trim() || `${note.title} ${note.content} ${note.tags} ${note.subject}`.toLowerCase().includes(noteQuery.trim().toLowerCase()));
  const visibleRecords = records.slice((recordPage - 1) * 10, recordPage * 10);
  const visibleNotes = filteredNotes.slice((notePage - 1) * 10, notePage * 10);
  function youtubeEmbedUrl(value: string, startSeconds = 0) {
    try {
      const url = new URL(value.trim());
      let id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? "");
      id = id.split(/[?&]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1&enablejsapi=1${startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : ""}` : "";
    } catch { return ""; }
  }

  function youtubeWatchUrl(value: string) {
    try {
      const url = new URL(value.trim());
      const id = (url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? "")).split(/[?&]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : "";
    } catch { return ""; }
  }

  const bookResources = resources.filter((item) => item.resourceType === "book" && item.status !== "archived").sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
  const courseResources = resources.filter((item) => item.resourceType === "course" && item.status !== "archived").sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
  const defaultExpandedBookId = selectedResourceId === null ? (bookResources[0]?.id ?? null) : null;
  const currentExpandedBookId = expandedBookId ?? defaultExpandedBookId;
  const selectedResource = resources.find((item) => item.id === selectedResourceId && ((activeTab === "courses" && item.resourceType === "course") || (activeTab === "books" && item.resourceType === "book"))) ?? (activeTab === "courses" ? courseResources[0] : bookResources[0]) ?? null;
  const selectedProgress = selectedResource ? resourceProgress[String(selectedResource.id)] : undefined;
  const selectedSegment = resourceSegments.find((segment) => segment.id === (selectedSegmentId ?? selectedProgress?.segmentId)) ?? null;
  const courseSummarySegments = resourceSegments.filter((segment) => segment.summary.trim() || segment.recommended);
  const selectedChapter = bookChapters.find((chapter) => chapter.id === selectedChapterId) ?? null;

  function todayValue() { return taipeiDate(); }
  function updateResourceProgress(resourceId: number, next: Partial<{ page: number; segmentId: number | null; positionSeconds: number }>) {
    const updated = { page: 1, segmentId: null, positionSeconds: 0, updatedAt: new Date().toISOString(), ...resourceProgress[String(resourceId)], ...next };
    const nextState = { ...resourceProgress, [String(resourceId)]: updated };
    setResourceProgress(nextState);
    window.localStorage.setItem("silu-resource-progress", JSON.stringify(nextState));
  }
  async function addResourceTask(resource: LearningResource) {
    const isCourse = resource.resourceType === "course";
    const response = await fetch("/api/study-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: todayValue(), subject: resource.subject || "綜合", title: `${isCourse ? "影音" : "閱讀"}｜${resource.title}`, durationMinutes: isCourse ? 45 : 60, details: `[resource:${resource.id}] ${resource.description || `在學習專區內${isCourse ? "觀看課程與字幕" : "閱讀書籍內容"}，完成後留下接續點。`}` }) });
    const result = await response.json() as { error?: string };
    setResourceMessage(response.ok ? "已加入今天的行事曆，完成後會寫入學習紀錄。" : (result.error ?? "加入今日計畫失敗"));
    if (response.ok) await load();
  }
  async function logResourceStudy(resource: LearningResource, actualMinutes: number, nextStep: string) {
    const segmentLabel = resource.resourceType === "book"
      ? (selectedChapter ? `｜${selectedChapter.title}` : "")
      : (selectedSegment ? `｜${selectedSegment.title}` : "");
    const response = await fetch("/api/learning-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordDate: todayValue(), subject: resource.subject || "綜合", title: `${resource.title}${segmentLabel}`, activityType: resource.resourceType === "course" ? "影音課程學習" : "書籍學習", actualMinutes, nextStep }) });
    setResourceMessage(response.ok ? "已記錄今天的學習內容；AI 導師下次對話會讀取這筆紀錄。" : "學習紀錄暫時無法儲存");
    if (response.ok) { const result = await response.json() as { record?: StudyRecord }; if (result.record) setRecords((current) => [result.record!, ...current]); }
  }

  function bookContext(chapter: ResourceSegment) {
    const pages = chapter.pageStart ? `（第 ${chapter.pageStart}${chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""} 頁）` : "";
    return `教材：《${selectedResource?.title ?? ""}》；科目：${selectedResource?.subject ?? "綜合"}；目前章節：${chapter.title}${pages}。${chapter.summary ? `章節摘要：${chapter.summary}` : ""}`;
  }

  async function startBookChapter(chapter: ResourceSegment) {
    if (!selectedResource || selectedResource.resourceType !== "book") return;
    setSelectedChapterId(chapter.id);
    setBookMessages([]);
    setBookInput("");
    setBookChatLoading(true);
    const prompt = `${bookContext(chapter)}\n請開始教我這一章。先用一小段話說明本章要學會什麼，再提出一個學生可以直接回答的問題；請嚴格以這本教材為優先依據，不要先傾倒完整解答。`;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "student", text: prompt }] }) });
      const result = await response.json() as { reply?: string; error?: string };
      setBookMessages([{ role: "mentor", text: response.ok ? (result.reply ?? "我們先從這一章開始。") : (result.error ?? "AI 教學暫時無法開始") }]);
    } catch {
      setBookMessages([{ role: "mentor", text: "教材章節已開啟，但 AI 暫時沒有回應。請稍後再按一次章節。" }]);
    } finally {
      setBookChatLoading(false);
    }
  }

  async function sendBookMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = bookInput.trim();
    if (!text || !selectedChapter || !selectedResource || bookChatLoading) return;
    const studentMessage = { role: "student" as const, text: `${bookContext(selectedChapter)}\n學生回覆：${text}` };
    const nextMessages = [...bookMessages, studentMessage].slice(-12);
    setBookMessages(nextMessages);
    setBookInput("");
    setBookChatLoading(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: nextMessages }) });
      const result = await response.json() as { reply?: string; error?: string };
      setBookMessages((current) => [...current, { role: "mentor", text: response.ok ? (result.reply ?? "我們接著往下釐清。") : (result.error ?? "AI 教學暫時無法回應") }]);
    } catch {
      setBookMessages((current) => [...current, { role: "mentor", text: "這次回覆沒有送出成功，請再試一次。" }]);
    } finally {
      setBookChatLoading(false);
    }
  }

  async function addRecord() {
    if (!recordDraft.title.trim()) return;
    const response = await fetch("/api/learning-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...recordDraft, activityType: "手動補登" }) });
    if (!response.ok) return;
    const result = await response.json() as { record: StudyRecord }; setRecords((current) => [result.record, ...current]); setRecordDraft({ subject: "刑法", title: "", actualMinutes: 60, weakness: "", nextStep: "" }); setRecordPage(1);
  }

  async function saveNote() {
    if (!noteDraft) return;
    const response = await fetch("/api/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(noteDraft) });
    if (!response.ok) return;
    setNotes((current) => current.map((note) => note.id === noteDraft.id ? { ...noteDraft, updatedAt: new Date().toISOString() } : note)); setNoteDraft(null);
  }

  async function addBlankNote() {
    const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "未命名筆記", content: "", subject: "綜合", sourceType: "manual" }) });
    if (!response.ok) return;
    const result = await response.json() as { note: SavedNote };
    setNotes((current) => [result.note, ...current]);
    setNoteDraft(result.note);
  }

  async function removeNote() {
    if (!noteDraft || !window.confirm(`確定刪除「${noteDraft.title}」？`)) return;
    const response = await fetch(`/api/notes?id=${noteDraft.id}`, { method: "DELETE" });
    if (response.ok) { setNotes((current) => current.filter((note) => note.id !== noteDraft.id)); setNoteDraft(null); }
  }

  return <main className="plan-shell">
    <header className="topbar">
      <a href="/" className="brand"><span className="brand-mark">律</span><span>司律備考</span></a>
      <div className="top-actions"><a href="/" className="back-link">返回對話</a><a href="/admin" className="admin-link">管理後台</a></div>
    </header>
    <div className="plan-main">
      <div className="plan-header">
        <div><p>MY LEARNING CENTER</p><h1>學習專區</h1><span>{plans[0] ? `${plans[0].targetLabel} · 每日 ${plans[0].dailyMinutes} 分鐘` : "和司律備考聊完後，AI 會把任務寫到這裡"}</span></div>
        {activeTab === "calendar" && <div className="calendar-header-actions"><button className="reset-plan-btn" onClick={openResetPlanner}>↻ AI 重新規劃</button><button className="add-task" onClick={() => openNew()}>＋ 新增任務</button></div>}
      </div>
      <nav className="plan-tabs"><button className={activeTab === "calendar" ? "active" : ""} onClick={() => setActiveTab("calendar")}>行事曆</button><button className={activeTab === "practice" ? "active" : ""} onClick={() => setActiveTab("practice")}>主動刷題</button><button className={activeTab === "books" ? "active" : ""} onClick={() => setActiveTab("books")}>書籍</button><button className={activeTab === "courses" ? "active" : ""} onClick={() => setActiveTab("courses")}>影音課程</button><button className={activeTab === "laws" ? "active" : ""} onClick={() => setActiveTab("laws")}>法規搜尋</button><button className={activeTab === "listening" ? "active" : ""} onClick={() => setActiveTab("listening")}>聽解題</button><button className={activeTab === "magazine" ? "active" : ""} onClick={() => setActiveTab("magazine")}>法教專區</button><button className={activeTab === "records" ? "active" : ""} onClick={() => setActiveTab("records")}>學習紀錄 <span>{records.length}</span></button><button className={activeTab === "conversations" ? "active" : ""} onClick={() => setActiveTab("conversations")}>每日對話 <span>{chatDays.length}</span></button><button className={activeTab === "exam-conversations" ? "active" : ""} onClick={() => setActiveTab("exam-conversations")}>試題問答 <span>{examConversations.length}</span></button><button className={activeTab === "notes" ? "active" : ""} onClick={() => setActiveTab("notes")}>筆記收藏 <span>{notes.length}</span></button></nav>
      {activeTab === "listening" && <section className="learning-single-column" aria-label="聽解題專區"><div className="column-card listening-feature"><div className="column-kicker">LISTENING SOLUTION</div><div className="column-heading"><div><h2>聽解題</h2><span>已發布的題目都會保留在學習區，方便依序練習</span></div><i>{(homeFeed?.listeningItems ?? (homeFeed?.listening ? [homeFeed.listening] : [])).length ? "▶" : "聽"}</i></div>{(homeFeed?.listeningItems ?? (homeFeed?.listening ? [homeFeed.listening] : [])).length ? <div className="listening-feed-list">{(homeFeed?.listeningItems ?? (homeFeed?.listening ? [homeFeed.listening] : [])).map((item) => <article className="listening-feed-item" key={item.id}><div className="listening-feed-heading"><div><span>{item.year || "自訂題目"} · {item.subject}</span><h3>{item.title}</h3></div><b>已發布</b></div><p>先聽老師如何抓爭點，再留下自己的答題接續點。</p><ListeningPlayer item={item} /></article>)}</div> : <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>}</div></section>}
      {(activeTab === "books" || activeTab === "courses") && <section className="resource-learning-hub" aria-label={activeTab === "books" ? "書籍學習" : "影音課程學習"}>
            <div className="resource-learning-head"><div><p>{activeTab === "books" ? "READING ROOM" : "COURSE ROOM"}</p><h2>{activeTab === "books" ? "書籍學習" : "影音課程學習"}</h2><span>{activeTab === "books" ? "不開啟 PDF；選章節後由 AI 依教材內容教學。" : "留在學習專區內完成；進度、今日計畫與學習紀錄會連在一起。"}</span></div><span className="resource-count">{(activeTab === "books" ? bookResources : courseResources).length} 項</span></div>
        <div className="resource-learning-layout"><aside className={`resource-list ${activeTab === "books" ? "book-resource-list" : ""}`} aria-label="可學習資源"><div className="resource-list-heading"><strong>{activeTab === "books" ? "書本清單" : "影音課程清單"}</strong><span>共 {(activeTab === "books" ? bookResources : courseResources).length} 項</span></div>{activeTab === "books" ? bookResources.map((resource) => {
          const isSelected = selectedResource?.id === resource.id;
          const isExpanded = currentExpandedBookId === resource.id;
          return <div className={`book-resource-card ${isSelected ? "active" : ""}`} key={resource.id}>
            <button className="book-resource-trigger" aria-expanded={isExpanded} onClick={() => { setSelectedResourceId(resource.id); setExpandedBookId(isExpanded ? null : resource.id); setSelectedSegmentId(null); setSelectedChapterId(null); setBookMessages([]); setResourceMessage(""); }}><span>書</span><div><strong>{resource.title}</strong><small>{resource.subject}{resource.creator ? ` · ${resource.creator}` : ""}</small><em>{resourceProgress[String(resource.id)] ? "已有學習紀錄" : resource.documentId ? "教材已綁定，點此展開章節" : "尚未綁定教材"}</em></div><b aria-hidden>{isExpanded ? "−" : "+"}</b></button>
            {isExpanded && <div className="book-resource-chapters" aria-label={`${resource.title}章節`}><div className="book-chapter-heading"><strong>本書章節</strong><span>{bookChaptersLoading && isSelected ? "正在準備…" : bookChapters.length && isSelected ? `${bookChapters.length} 章` : "尚未建立"}</span></div>{!isSelected ? <div className="book-chapter-empty">選取這本書後載入章節。</div> : bookChaptersLoading ? <div className="book-chapter-empty">正在準備本書章節目錄，完成後會自動顯示…</div> : bookChapters.length ? bookChapters.map((chapter, index) => <button key={chapter.id} className={selectedChapter?.id === chapter.id ? "active" : ""} onClick={() => void startBookChapter(chapter)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{chapter.title}</strong>{chapter.summary && <small>{chapter.summary}</small>}{chapter.pageStart && <em>第 {chapter.pageStart}{chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""} 頁</em>}</div></button>) : <div className="book-chapter-empty">{bookChapterMessage || "教材索引完成後，章節目錄會在這裡建立。"}<br /><button type="button" className="chapter-retry" onClick={() => { chapterBuildAttemptedRef.current.delete(resource.id); void loadBookChapters(resource.id); }}>重新建立章節</button></div>}</div>}
          </div>;
        }) : courseResources.map((resource, index) => <button key={resource.id} className={selectedResource?.id === resource.id ? "active" : ""} onClick={() => { setSelectedResourceId(resource.id); setSelectedSegmentId(null); setSelectedChapterId(null); setBookMessages([]); setResourceMessage(""); }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{resource.title}</strong><small>{resource.subject}{resource.creator ? ` · ${resource.creator}` : ""}</small><em>{resourceProgress[String(resource.id)] ? "已有學習紀錄" : "尚未開始"}</em></div></button>)}{!(activeTab === "books" ? bookResources : courseResources).length && <div className="resource-empty">後台尚未建立{activeTab === "books" ? "書籍" : "影音課程"}資源。</div>}</aside>
          {selectedResource ? <article className="resource-study-panel"><header><div><span>{selectedResource.subject} · {selectedResource.resourceType === "book" ? "書籍" : "影音課程"}</span><h3>{selectedResource.title}</h3>{selectedResource.creator && <small>{selectedResource.creator}</small>}</div><div className="resource-panel-actions"><button className="secondary-btn" onClick={() => void addResourceTask(selectedResource)}>＋ 加入今日計畫</button><button className="primary-btn" onClick={() => void logResourceStudy(selectedResource, selectedResource.resourceType === "course" ? 45 : 60, selectedResource.resourceType === "course" ? "下次從上次字幕段落接續" : `下次從${selectedChapter?.title ? `「${selectedChapter.title}」` : "目前章節"}接續`)}>完成本次學習</button></div></header>
            {resourceMessage && <p className="resource-message">{resourceMessage}</p>}
            {selectedResource.resourceType === "book" ? <div className="book-learning-room"><section className="book-ai-dialogue" aria-label="書籍 AI 教學"><div className="book-ai-heading"><div><span>AI 教材教學</span><strong>{selectedChapter ? selectedChapter.title : "先選一個章節"}</strong></div><small>{selectedChapter ? "依本章內容開始對話" : "從左側書本下方展開章節，AI 會直接開始教你"}</small></div>{selectedChapter ? <><div className="book-dialogue-messages">{bookMessages.map((message, index) => <div key={`${message.role}-${index}`} className={`book-dialogue-message ${message.role}`}><span>{message.role === "mentor" ? "AI 教練" : "你"}</span><p>{message.text}</p></div>)}{bookChatLoading && <div className="book-dialogue-message mentor"><span>AI 教練</span><p className="book-typing">正在整理本章內容…</p></div>}<div ref={bookDialogueEndRef} /></div><form className="book-dialogue-form" onSubmit={sendBookMessage}><textarea value={bookInput} onChange={(event) => setBookInput(event.target.value)} placeholder="回覆 AI 教練，繼續這一章…" disabled={bookChatLoading} rows={2} /><button type="submit" disabled={bookChatLoading || !bookInput.trim()}>送出</button></form></> : <div className="book-dialogue-empty"><div>AI</div><strong>選一個章節，開始學習</strong><p>這裡不顯示 PDF。AI 會依教材內容先教你抓本章重點，再用問題帶你思考。</p></div>}</section></div> : <div className="course-reader"><div className="course-player">{youtubeEmbedUrl(selectedResource.sourceUrl, selectedSegment?.startSeconds ?? selectedProgress?.positionSeconds ?? 0) ? <iframe key={`${selectedResource.id}-${selectedSegment?.id || 0}`} src={youtubeEmbedUrl(selectedResource.sourceUrl, selectedSegment?.startSeconds ?? selectedProgress?.positionSeconds ?? 0)} title={`${selectedResource.title}影音播放器`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : selectedResource.sourceUrl ? <CourseVideoPlayer resourceId={selectedResource.id} sourceUrl={selectedResource.sourceUrl} title={`${selectedResource.title}影音播放器`} startSeconds={selectedSegment?.startSeconds ?? selectedProgress?.positionSeconds ?? 0} seekToken={courseSeekToken} onError={setCoursePlayerError} onTimeChange={(seconds) => { const currentSecond = Math.floor(seconds); updateResourceProgress(selectedResource.id, { positionSeconds: currentSecond }); const active = [...courseSummarySegments].reverse().find((segment) => (segment.startSeconds ?? Number.POSITIVE_INFINITY) <= currentSecond); if (active && active.id !== selectedSegmentId) setSelectedSegmentId(active.id); }} /> : <div className="resource-empty">這堂課尚未設定影片網址。</div>}</div>{coursePlayerError && <div className="course-preview-error" role="alert">{coursePlayerError}</div>}<div className="course-study-meta"><div><strong>{selectedSegment ? "目前重點摘要" : "時間點重點摘要"}</strong><span>{selectedSegment?.summary || (courseSummarySegments.length ? `已整理 ${courseSummarySegments.length} 個時間點重點；點擊下方摘要即可跳到對應講解。` : "後台尚未上傳可跳轉的時間點重點。")}</span></div>{selectedResource.sourceUrl && <a href={youtubeWatchUrl(selectedResource.sourceUrl) || selectedResource.sourceUrl} target="_blank" rel="noreferrer">另開課程頁 ↗</a>}</div>{courseSummarySegments.length > 0 && <div className="course-segment-list">{courseSummarySegments.map((segment) => <button key={segment.id} className={selectedSegment?.id === segment.id ? "active" : ""} onClick={() => { setSelectedSegmentId(segment.id); updateResourceProgress(selectedResource.id, { segmentId: segment.id, positionSeconds: segment.startSeconds || 0 }); setCourseSeekToken((token) => token + 1); }}><span>{segment.startSeconds != null ? formatMediaTime(segment.startSeconds) : segment.sequence}</span><div><strong>{segment.title}</strong>{segment.summary && <small>{segment.summary}</small>}</div></button>)}</div>}</div>}
          </article> : <div className="resource-empty resource-empty-large">先從左側選擇一項{activeTab === "books" ? "書籍" : "影音課程"}，就在這裡開始。</div>}
        </div>
      </section>}
      {activeTab === "magazine" && <section className="learning-single-column" aria-label="法教專區"><div className="column-card law-column rail-magazine-card"><div className="column-kicker">LAW CLASSROOM</div><div className="column-heading"><div><h2>法教專區</h2><span>已發布的期數都會保留，摘要與核心爭點分開整理</span></div><i>法</i></div>{(homeFeed?.magazines ?? (homeFeed?.magazine ? [homeFeed.magazine] : [])).length ? <div className="magazine-feed-list">{(homeFeed?.magazines ?? (homeFeed?.magazine ? [homeFeed.magazine] : [])).map((magazine) => <article className="magazine-feed-item" key={magazine.id}><strong>{magazine.title}</strong>{magazine.isDraft && <p className="column-notice">目前先顯示後台匯入的試讀目錄，完整分析仍由後台確認。</p>}<div className="magazine-article-list">{(magazine.articles ?? []).map((article) => <div className="magazine-article-row" key={article.id}><div className="magazine-article-copy"><h3>{article.title}</h3>{article.summary && <p className="magazine-article-summary"><b>摘要</b>{article.summary}</p>}<p className="magazine-article-issue"><b>核心爭點</b>{article.issue || (article.reviewStatus === "draft" ? "尚待後台分析／發布" : "尚未擷取核心爭點")}</p></div></div>)}</div><a href={magazine.sourceUrl} target="_blank" rel="noreferrer">查看本期來源 →</a></article>)}</div> : <p className="column-empty">後台尚未發布法學教室期數。</p>}</div></section>}
      {activeTab === "calendar" && <><div className="calendar-toolbar"><button onClick={() => moveMonth(-1)}>‹</button><strong>{month.replace("-", " 年 ")} 月</strong><button onClick={() => moveMonth(1)}>›</button></div>
      <div className="calendar-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {days.map((day, index) => <div className={`calendar-day ${day ? "" : "blank"}`} key={`${day}-${index}`} onDoubleClick={() => day && openNew(day)}>{day && <><span className="day-number">{day}</span><div className="day-tasks">{tasks.filter((task) => task.taskDate === dateFor(day)).map((task) => <div className={`calendar-task ${task.status === "completed" ? "done" : ""}`} key={task.id} onClick={() => openTask(task)}><button onClick={(event) => { event.stopPropagation(); void toggle(task); }} aria-label="切換完成狀態">{task.status === "completed" ? "✓" : ""}</button><div><strong>{task.subject}</strong><span>{task.title}</span><small>{task.durationMinutes} 分鐘</small></div></div>)}</div><button className="day-add" onClick={() => openNew(day)}>＋</button></>}</div>)}
      </div>
      </>}
      {activeTab === "practice" && <PracticeLab initialType="mcq" />}
      {activeTab === "laws" && <div className="legal-judicial-stack"><LegalSearch /><JudicialSearch /></div>}
      {activeTab === "records" && <section className="learning-hub tab-hub" id="records">
        <div className="hub-heading"><div><p>LEARNING HISTORY</p><h2>學習紀錄</h2><span>完成讀書任務與一試練題後會自動寫入，也保留實際時間、弱點與下次接續點。</span></div><strong>{records.length} 筆</strong></div>
        <div className="record-entry"><select value={recordDraft.subject} onChange={(event) => setRecordDraft({ ...recordDraft, subject: event.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select><input value={recordDraft.title} onChange={(event) => setRecordDraft({ ...recordDraft, title: event.target.value })} placeholder="今天實際學了什麼？" /><input type="number" min="0" max="720" value={recordDraft.actualMinutes} onChange={(event) => setRecordDraft({ ...recordDraft, actualMinutes: Number(event.target.value) })} aria-label="實際分鐘" /><input value={recordDraft.weakness} onChange={(event) => setRecordDraft({ ...recordDraft, weakness: event.target.value })} placeholder="發現的弱點（可不填）" /><input value={recordDraft.nextStep} onChange={(event) => setRecordDraft({ ...recordDraft, nextStep: event.target.value })} placeholder="下次從哪裡接續？" /><button onClick={addRecord}>補登紀錄</button></div>
        {visibleRecords.length ? <div className="record-list">{visibleRecords.map((record) => <article key={record.id}><time>{record.recordDate}</time><div><strong>{record.subject} · {record.title}</strong><span>{record.activityType} · 實際 {record.actualMinutes} 分鐘{record.correct === null ? "" : record.correct ? " · 答對" : " · 待補強"}</span>{record.weakness && <small>弱點：{record.weakness}</small>}{record.nextStep && <small>下次接續：{record.nextStep}</small>}</div></article>)}</div> : <div className="hub-empty">完成第一項任務、練完第一題或手動補登後，紀錄會出現在這裡。</div>}
        {records.length > 10 && <nav className="document-pagination"><button disabled={recordPage === 1} onClick={() => setRecordPage((page) => page - 1)}>上一頁</button><span>第 {recordPage} / {Math.ceil(records.length / 10)} 頁</span><button disabled={recordPage >= Math.ceil(records.length / 10)} onClick={() => setRecordPage((page) => page + 1)}>下一頁</button></nav>}
      </section>}
      {activeTab === "conversations" && <section className="learning-hub tab-hub" id="conversations">
        <div className="hub-heading"><div><p>DAILY CONVERSATIONS</p><h2>每日對話</h2><span>每天一個新對話；昨天的內容會保留，並成為今天 AI 教練的接續依據。</span></div><strong>{chatDays.length} 天</strong></div>
        {chatDays.length ? <div className="daily-chat-list">{chatDays.map((day) => <article className="daily-chat-card" key={day.id}><button type="button" className="daily-chat-summary" onClick={() => setOpenChatDay(openChatDay === day.id ? null : day.id)}><span>{day.date}</span><div><strong>{day.title.replace(/^\d{4}-\d{2}-\d{2}｜/, "") || "司律備考學習對話"}</strong><small>{day.messageCount} 則訊息 · {day.progressStatus === "active" ? "已進行" : "已保存"}</small></div><b>{openChatDay === day.id ? "收合" : "查看"}</b></button>{openChatDay === day.id && <div className="daily-chat-messages">{day.messages.map((message, index) => <div className={`daily-chat-message ${message.role}`} key={`${day.id}-${index}`}><span>{message.role === "mentor" ? "AI 教練" : "我"}</span><p>{message.text}</p></div>)}</div>}</article>)}</div> : <div className="hub-empty">今天開始對話後，每日紀錄會自動保留在這裡。</div>}
      </section>}
      {activeTab === "exam-conversations" && <section className="learning-hub tab-hub" id="exam-conversations">
        <div className="hub-heading"><div><p>QUESTION COACH HISTORY</p><h2>試題問答</h2><span>一試、二試在題目內的 AI 對話會依題目保存，之後可回看學習。</span></div><strong>{examConversations.length} 題</strong></div>
        {examConversations.length ? <div className="daily-chat-list">{examConversations.map((conversation) => <article className="daily-chat-card" key={conversation.questionId}><button type="button" className="daily-chat-summary" onClick={() => setOpenExamConversation(openExamConversation === conversation.questionId ? null : conversation.questionId)}><span>{conversation.year}</span><div><strong>{conversation.subject} · 第 {conversation.questionNumber} 題</strong><small>{conversation.messages.length} 則問答</small></div><b>{openExamConversation === conversation.questionId ? "收合" : "查看"}</b></button>{openExamConversation === conversation.questionId && <div className="daily-chat-messages"><p className="exam-history-stem">{conversation.stem}</p>{conversation.messages.map((message) => <div className={`daily-chat-message ${message.role}`} key={message.id}><span>{message.role === "mentor" ? "AI 教練" : "我"}</span><p>{message.text}</p></div>)}</div>}</article>)}</div> : <div className="hub-empty">在試題卡片內開始 AI 對話後，紀錄會自動保留在這裡。</div>}
      </section>}
      {activeTab === "notes" && <section className="learning-hub tab-hub" id="notes">
        <div className="hub-heading"><div><p>MY COLLECTION</p><h2>筆記收藏</h2><span>從導師對話一鍵收藏，保留教材來源並可依科目、標籤與內容搜尋。</span></div><div className="hub-heading-actions"><strong>{notes.length} 則</strong><button className="secondary-btn" onClick={() => void addBlankNote()}>＋ 空白筆記</button></div></div>
        <input className="note-search" value={noteQuery} onChange={(event) => { setNoteQuery(event.target.value); setNotePage(1); }} placeholder="搜尋筆記、科目或標籤…" />
        {visibleNotes.length ? <div className="note-list">{visibleNotes.map((note) => <article key={note.id} onClick={() => setNoteDraft(note)}><div><span>{note.subject}</span>{note.tags && <em>{note.tags}</em>}<button>編輯</button></div><strong>{note.title}</strong><p>{note.content}</p>{note.sourceLabel && <small>教材來源：{note.sourceLabel}</small>}</article>)}</div> : <div className="hub-empty">尚未收藏筆記。回到對話後，按下 AI 回答下方的「收藏筆記」即可加入。</div>}
        {filteredNotes.length > 10 && <nav className="document-pagination"><button disabled={notePage === 1} onClick={() => setNotePage((page) => page - 1)}>上一頁</button><span>第 {notePage} / {Math.ceil(filteredNotes.length / 10)} 頁</span><button disabled={notePage >= Math.ceil(filteredNotes.length / 10)} onClick={() => setNotePage((page) => page + 1)}>下一頁</button></nav>}
      </section>}
    </div>
    {draft && <div className="editor-backdrop" onClick={() => setDraft(null)}><section className="task-editor" onClick={(event) => event.stopPropagation()}><div className="editor-title"><h2>{draft.id ? "編輯讀書任務" : "新增讀書任務"}</h2><button onClick={() => setDraft(null)}>×</button></div><label className="field">日期<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label><label className="field">科目<select value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">任務名稱<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：不作為犯基本觀念" /></label><label className="field">預計時間（分鐘）<input type="number" min="10" max="480" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label><label className="field">學習內容<textarea value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={4} /></label><label className="complete-check"><input type="checkbox" checked={draft.status === "completed"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "completed" : "pending" })} />已完成</label>{message && <p className="editor-message">{message}</p>}<div className="editor-actions">{draft.id && <button className="delete-task" onClick={remove}>刪除</button>}<button className="primary-btn" onClick={save}>儲存任務</button></div></section></div>}
    {noteDraft && <div className="editor-backdrop" onClick={() => setNoteDraft(null)}><section className="task-editor note-editor" onClick={(event) => event.stopPropagation()}><div className="editor-title"><h2>編輯筆記</h2><button onClick={() => setNoteDraft(null)}>×</button></div><label className="field">標題<input value={noteDraft.title} onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} /></label><label className="field">科目<select value={noteDraft.subject} onChange={(e) => setNoteDraft({ ...noteDraft, subject: e.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">標籤<input value={noteDraft.tags} onChange={(e) => setNoteDraft({ ...noteDraft, tags: e.target.value })} placeholder="重要、待複習…" /></label><label className="field">筆記內容<textarea value={noteDraft.content} onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })} rows={9} /></label>{noteDraft.sourceLabel && <p className="note-source-readonly">教材來源：{noteDraft.sourceLabel}</p>}<div className="editor-actions"><button className="delete-task" onClick={removeNote}>刪除筆記</button><button className="primary-btn" onClick={saveNote}>儲存筆記</button></div></section></div>}
    {resetPlanOpen && <div className="editor-backdrop" onClick={() => !resetPlanLoading && setResetPlanOpen(false)}><section className="task-editor reset-plan-dialog" onClick={(event) => event.stopPropagation()}><div className="editor-title"><div><p>AI STUDY PLANNER</p><h2>{resetPlanDraft.step === "preview" ? "確認新的讀書計畫" : "想怎麼重新規劃？"}</h2></div><button disabled={resetPlanLoading} onClick={() => setResetPlanOpen(false)}>×</button></div>
      {resetPlanDraft.step === "settings" ? <>
        <div className="planner-mode"><button className={resetPlanDraft.mode === "all" ? "active" : ""} onClick={() => setResetPlanDraft({ ...resetPlanDraft, mode: "all", clearScope: "all" })}><strong>全科備考</strong><span>AI 依弱點分配各科比重</span></button><button className={resetPlanDraft.mode === "single" ? "active" : ""} onClick={() => setResetPlanDraft({ ...resetPlanDraft, mode: "single", clearScope: "subject" })}><strong>單科專攻</strong><span>集中學好一個法律科目</span></button></div>
        {resetPlanDraft.mode === "single" && <div className="reset-plan-fields planner-subject-fields"><label className="field">選擇法律<select value={resetPlanDraft.subject} onChange={(event) => { const subject = event.target.value; setResetPlanDraft({ ...resetPlanDraft, subject, scope: "全科" }); }}>{planningSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="field">學習範圍<select value={resetPlanDraft.scope} onChange={(event) => setResetPlanDraft({ ...resetPlanDraft, scope: event.target.value })}>{(subjectScopes[resetPlanDraft.subject] ?? ["全科"]).map((scope) => <option key={scope}>{scope}</option>)}</select></label></div>}
        <div className="reset-plan-fields"><label className="field">目前程度<select value={resetPlanDraft.level} onChange={(event) => setResetPlanDraft({ ...resetPlanDraft, level: event.target.value as ResetPlanDraft["level"] })}><option>初學</option><option>有基礎</option><option>進階</option></select></label><label className="field">每日可用時間（分鐘）<input type="number" min="30" max="720" step="30" value={resetPlanDraft.dailyMinutes} onChange={(event) => setResetPlanDraft({ ...resetPlanDraft, dailyMinutes: Math.max(30, Number(event.target.value) || 30) })} /></label><label className="field">規劃期間<select value={resetPlanDraft.days} onChange={(event) => setResetPlanDraft({ ...resetPlanDraft, days: Number(event.target.value) })}><option value={7}>接下來 7 天</option><option value={14}>接下來 14 天</option><option value={30}>接下來 30 天</option></select></label>{resetPlanDraft.mode === "single" && <label className="field">原行程處理<select value={resetPlanDraft.clearScope} onChange={(event) => setResetPlanDraft({ ...resetPlanDraft, clearScope: event.target.value as ResetPlanDraft["clearScope"] })}><option value="subject">只清除並重排{resetPlanDraft.subject}</option><option value="all">清空整張行事曆</option></select></label>}</div>
        <div className="planner-choice"><strong>學習目標</strong><div>{planningGoals.map((goal) => <button key={goal} className={resetPlanDraft.goals.includes(goal) ? "active" : ""} onClick={() => togglePlanningItem("goals", goal)}>{goal}</button>)}</div></div>
        <div className="planner-choice"><strong>納入學習內容</strong><div>{planningResources.map((resource) => <button key={resource} className={resetPlanDraft.resources.includes(resource) ? "active" : ""} onClick={() => togglePlanningItem("resources", resource)}>{resource}</button>)}</div></div>
        <div className="editor-actions"><button className="secondary-btn" onClick={() => setResetPlanOpen(false)}>取消</button><button className="planner-next-btn" disabled={!resetPlanDraft.goals.length || !resetPlanDraft.resources.length} onClick={() => setResetPlanDraft({ ...resetPlanDraft, step: "preview" })}>預覽規劃摘要</button></div>
      </> : <>
        <div className="planner-summary"><span>{resetPlanDraft.mode === "single" ? "單科專攻" : "全科備考"}</span><h3>{resetPlanDraft.mode === "single" ? `${resetPlanDraft.subject}｜${resetPlanDraft.scope}` : "司律全科讀書計畫"}</h3><p>{resetPlanDraft.days} 天｜每天 {resetPlanDraft.dailyMinutes} 分鐘｜{resetPlanDraft.level}</p><dl><div><dt>學習目標</dt><dd>{resetPlanDraft.goals.join("、")}</dd></div><div><dt>學習內容</dt><dd>{resetPlanDraft.resources.join("、")}</dd></div><div><dt>行程處理</dt><dd>{resetPlanDraft.mode === "single" && resetPlanDraft.clearScope === "subject" ? `只清除目前的${resetPlanDraft.subject}任務，其他科目保留` : "清空目前行事曆任務後重新安排"}</dd></div></dl></div>
        <div className="reset-plan-warning"><strong>學習成果不會被刪除</strong><p>已完成的學習紀錄、作答結果、弱點分析、每日對話與筆記都會保留，並提供給 AI 作為重排依據。</p></div>{resetPlanMessage && <p className={`reset-plan-message ${resetPlanMessage.includes("已替換") ? "success" : ""}`}>{resetPlanMessage}</p>}<div className="editor-actions"><button className="secondary-btn" disabled={resetPlanLoading} onClick={() => setResetPlanDraft({ ...resetPlanDraft, step: "settings" })}>返回修改</button><button className="reset-confirm-btn" disabled={resetPlanLoading} onClick={() => void clearAndReplan()}>{resetPlanLoading ? "AI 正在規劃…" : "確認並建立計畫"}</button></div>
      </>}
    </section></div>}
  </main>;
}
