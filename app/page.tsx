"use client";

import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "./listening-player";
import { taipeiDate, taipeiGreeting } from "../lib/taipei-time";
import { formatTwd } from "../lib/currency";

type ComparisonResponse = {
  id: number;
  label: string;
  model: string;
  text: string;
  source: "教材" | "AI 補充";
  sources: string[];
  error?: string | null;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsd: number; durationMs: number };
  stopReason?: string | null;
};
type ModelComparison = { id: number; sourceStatus: string; responses: ComparisonResponse[] };
type EvaluationUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number };
type TeachingLevel = "general" | "beginner" | "intermediate" | "advanced" | "super";
const teachingLevelLabels: Record<TeachingLevel, string> = {
  general: "自由提問",
  beginner: "法律小白",
  intermediate: "基礎考生",
  advanced: "進階考生",
  super: "頂尖學霸",
};
type TeachingRound = { level: TeachingLevel; label: string; reply: string; teacherA: { label?: string; model: string; text: string; usage: EvaluationUsage; stopReason: string | null }; teacherB?: { label?: string; model: string; text: string; usage: EvaluationUsage; stopReason: string | null } };
type TeachingEvidence = { status: "verified" | "applied_inference" | "full_text_search" | "unavailable"; retrieval: string; resourceTitle: string; segmentTitle: string; lessonLabel: string; pageStart: number | null; pageEnd: number | null; fileName: string; excerpt: string; message: string; matchedTerms?: string[] };
type Message = { role: "mentor" | "student"; text: string; sources?: string[]; citationStatus?: string; teachingEvidence?: TeachingEvidence | null; model?: string; usage?: ReplyUsage; comparison?: ModelComparison };
type FollowUpSelection = { key: string; label: string; model: string; text: string; prompt: string; excerpt?: string };
type AnswerAction = "plain" | "detailed" | "follow-up";
type ReplyUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsd: number };
type ChatModelMode = "luna" | "sonnet" | "deepseek" | "glm" | "glm52" | "compare-luna-sonnet" | "compare-luna-glm52" | "compare-luna-deepseek" | "compare-sonnet-deepseek" | "compare-luna-sonnet-deepseek";
const aiSettingsStorageKey = "silu-ai-settings-pinned";
const chatModelModes: ChatModelMode[] = ["luna", "sonnet", "deepseek", "glm", "glm52", "compare-luna-sonnet", "compare-luna-glm52", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"];
function isTeachingLevel(value: unknown): value is TeachingLevel { return value === "general" || value === "beginner" || value === "intermediate" || value === "advanced" || value === "super"; }
function isChatModelMode(value: unknown): value is ChatModelMode { return typeof value === "string" && chatModelModes.includes(value as ChatModelMode); }
type TodayTask = { id: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type DashboardData = { targetLabel: string; monthsRemaining: number; officialDatePending: boolean; todayProgress: { completed: number; total: number; delayed?: number; records?: number; correct?: number; answered?: number }; record: { completedTasks: number; completedMinutes: number; totalTasks: number }; priorities: Array<{ topic: string; count: number; reason: string }>; memo: string; encouragement: string };
type TodayRecord = { subject: string; title: string; activityType: string; actualMinutes: number; nextStep: string };
type YesterdayContext = { date: string; sessionId: number | null; messageCount: number; lastStudent: string; lastMentor: string; completedTasks: number; totalTasks: number; incompleteTasks: Array<{ id: number; subject: string; title: string; durationMinutes: number; details: string }>; records: Array<{ subject: string; title: string; activityType: string; actualMinutes: number; correct: boolean | null; weakness: string; nextStep: string }> };
type CropPoint = { x: number; y: number };
type ImageDraft = { url: string; name: string; points: CropPoint[]; rotation: number; enhance: boolean };
type PracticeQuestion = { id: number; examType: "mcq" | "essay"; year: string; subject: string; questionNumber: string; stem: string; options: Record<string, string> | null };
type MagazineArticle = { id: number; title: string; summary: string; issue: string; sourceUrl: string; reviewStatus: string; sequence: number };
type HomeFeed = { book: { id: number; title: string; creator: string; hasCover?: number } | null; course: { id: number; title: string; creator: string; sourceUrl: string } | null; magazine: { id: number; title: string; sourceUrl: string; description?: string; articles?: MagazineArticle[] } | null; listening: ListeningFeed | null; focusMusicUrl?: string; recommended: Array<{ id: number; resourceId: number; title: string; summary: string; startSeconds: number; importance: number }>; ticker: Array<{ id: string; text: string; url: string; enabled: boolean }>; examCountdowns: Array<{ id: string; label: string; date: string; enabled: boolean }> };
type LegalLesson = { documentId: number; title: string; articleNo: string; hierarchy: string; content: string };
type DictionaryResult = { term: string; content: string; sourceUrl: string; sourceLabel: string; sourceType?: "judicial" | "legispedia"; sourceNote?: string };
type PracticeCoachMessage = { role: "mentor" | "student"; text: string };
type PracticeRecommendation = { type: string; title: string; location: string; url: string; startSeconds: number | null };
type MobileRailTool = "dictionary" | "listening" | "magazine" | "music";

const quickStarts = ["帶我開始今天的刑法", "我想練一題司律真題", "幫我複習不作為犯"];
const trustPrincipleStudentTest = "我理解信賴原則是，駕駛人可以相信行人會遵守交通規則。可是如果行人只是站在路邊等紅綠燈，駕駛人應該可以信賴他不會突然衝出來；但如果行人已經有明顯要違規的樣子，例如一直往車道靠近，駕駛人就不能再主張信賴原則。那本題中，要怎麼判斷這個行人的動作已經達到「顯然即將違規」的程度？如果我主張駕駛人仍可相信行人不會衝出來，這樣的論證有機會成立嗎？";
function cleanMessageText(text: string) { return text.replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1"); }
function isLearningNote(text: string) { const clean = cleanMessageText(text); if (clean.length < 80) return false; if (/尚未匯入|尚未準備|暫時無法|沒有連上|API|錯誤|請稍後|管理者/.test(clean)) return false; return /法條|爭點|要件|涵攝|解題|判斷|原則|例外|學說|實務|教材|刑法|民法|訴訟法|憲法|行政法/.test(clean); }
function pairedStudentPrompt(messages: Message[], teacherIndex: number) {
  return [...messages.slice(0, teacherIndex)].reverse().find((message) => message.role === "student" && message.text.trim())?.text ?? "";
}
function youtubeId(value: string) { try { const url = new URL(value); const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? ""); return id.split(/[?&]/)[0]; } catch { return ""; } }
function youtubeEmbedUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&modestbranding=1&playsinline=1&enablejsapi=1` : ""; }
function youtubeWatchUrl(value: string) { const id = youtubeId(value); return /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : ""; }
function requestYoutubePlay(root: Element | null) { const iframe = root?.querySelector<HTMLIFrameElement>("iframe"); iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "https://www.youtube.com"); }
function dateLabel(value: string) { return value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日") : "今天"; }
function comparisonSourceLabel(status: string) {
  if (status === "verified") return "教材原文已直接支持";
  if (status === "applied_inference") return "教材提供判準，AI 完成涵攝";
  if (status === "full_text_search") return "找到相關教材，但直接支持不足";
  return "本次未取得可核對教材引用";
}
function citationStatusLabel(status?: string) {
  if (status === "verified") return "引用狀態：原文直接支持";
  if (status === "applied_inference") return "引用狀態：教材判準＋AI 涵攝";
  if (status === "full_text_search") return "引用狀態：相關原文，直接支持不足";
  return "引用狀態：未取得可核對教材";
}
function TeachingEvidenceDetails({ evidence }: { evidence?: TeachingEvidence | null }) {
  if (!evidence) return null;
  const pages = evidence.pageStart ? `第 ${evidence.pageStart}${evidence.pageEnd && evidence.pageEnd !== evidence.pageStart ? `–${evidence.pageEnd}` : ""} 頁` : "頁碼尚未核對";
  const label = evidence.status === "verified" ? "🟢 教材原文直接支持本次教學內容" : evidence.status === "applied_inference" ? "🔵 教材提供判準，AI 依原文涵攝" : evidence.status === "full_text_search" ? (evidence.retrieval === "full_text_search" ? "🟡 僅命中全文索引" : "🟡 已找到相關原文，直接支持不足") : "⚪ 未取得教材原文";
  return <details className={`teaching-evidence ${evidence.status}`}><summary>{label}<span>展開驗證證據</span></summary><div><dl><div><dt>書籍／檔案</dt><dd>{evidence.resourceTitle || evidence.fileName || "未提供"}</dd></div><div><dt>實際位置</dt><dd>{[evidence.segmentTitle, evidence.lessonLabel, pages].filter(Boolean).join("｜")}</dd></div><div><dt>檢索方式</dt><dd>{evidence.retrieval === "chapter_segment" ? "章節內文比對" : evidence.retrieval === "stored_analysis" ? "教材解析結果比對" : evidence.retrieval === "full_text_search" ? "全文索引搜尋" : "未使用教材"}</dd></div><div><dt>支持度判定</dt><dd>{evidence.message}</dd></div></dl>{evidence.matchedTerms?.length ? <p className="evidence-keywords"><b>命中關鍵：</b>{evidence.matchedTerms.join("、")}</p> : null}{evidence.excerpt ? <><b className="evidence-section-label">教材原文</b><blockquote>{evidence.excerpt}</blockquote><small>章節頁碼是本教材 PDF 的位置；原文註腳中的其他頁碼屬引用書目頁碼。</small></> : null}{evidence.status === "applied_inference" ? <p className="evidence-application"><b>AI 涵攝：</b>原文負責提供抽象判準；本次回答中的具體罪名或事實判斷由 AI 依該判準完成。</p> : null}<small>綠色＝教材直接支持回答或依原文出題；藍色＝教材提供判準、AI 正常涵攝；黃色＝只有相關內容，仍不足以支持回答。</small></div></details>;
}
function answerParagraphs(text: string) {
  const clean = cleanMessageText(text).trim();
  return clean.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}
function modelLabel(model: string) {
  return /claude/i.test(model) ? "Claude Sonnet" : /deepseek/i.test(model) ? "DeepSeek V4-Pro" : /glm-5\.2/i.test(model) ? "GLM-5.2（付費測試）" : /glm/i.test(model) ? "GLM-4.7-Flash（免費測試）" : "Luna";
}
function MentorAnswerText({ text, label, model, prompt, onAnswerAction, disabled, showLearningActions = false }: { text: string; label: string; model: string; prompt: string; onAnswerAction: (action: AnswerAction, selection: { label: string; model: string; text: string; prompt: string; excerpts: string[] }) => void; disabled?: boolean; showLearningActions?: boolean }) {
  const paragraphs = answerParagraphs(text);
  const actionSelection = { label, model, text, prompt, excerpts: paragraphs };
  return <>
    <div className="mentor-answer-text">
      {paragraphs.map((paragraph) => <div className="mentor-answer-paragraph" key={paragraph}><p>{paragraph}</p></div>)}
    </div>
    {!disabled && showLearningActions && <div className="answer-learning-actions">
      <button type="button" onClick={() => onAnswerAction("plain", actionSelection)}>白話解釋</button>
      <button type="button" onClick={() => onAnswerAction("detailed", actionSelection)}>詳解解析</button>
      <button type="button" className="answer-follow-up-button" onClick={() => onAnswerAction("follow-up", actionSelection)}>延伸追問</button>
    </div>}
  </>;
}
function ModelComparisonCard({ comparison, messageIndex, pairedPrompt, selectedKeys, onRate, onToggleFollowUp, onAnswerAction, thinking }: { comparison: ModelComparison; messageIndex: number; pairedPrompt: string; selectedKeys: string[]; onRate: (responseId: number, feedbackType: "preferred" | "rated", score: number) => Promise<void>; onToggleFollowUp: (selection: FollowUpSelection) => void; onAnswerAction: (action: AnswerAction, selection: { label: string; model: string; text: string; prompt: string; excerpts: string[] }) => void; thinking?: boolean }) {
  const [scores, setScores] = useState<Record<number, number>>({});
  const [saved, setSaved] = useState<number | null>(null);
  return <section className="model-comparison-card" aria-label="AI 模型測試比較">
    <header><div><b>AI 模型測試比較</b><span>{comparisonSourceLabel(comparison.sourceStatus)}</span></div><small>每個模型使用同一個問題；回覆、Token、耗時與估算成本都會保存。</small></header>
    <div className="model-comparison-grid">
      {comparison.responses.map((response) => <article className={`model-comparison-response ${selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`) ? "follow-up-selected" : ""}`} key={response.id}>
        <div className="model-comparison-response-head"><strong>{response.label}</strong><small>{response.model}</small></div>
        {response.error ? <p className="model-comparison-error">{response.error}</p> : <MentorAnswerText text={response.text} label={response.label} model={response.model} prompt={pairedPrompt} onAnswerAction={onAnswerAction} disabled={thinking} />}
        {response.stopReason === "max_tokens" && <small className="model-comparison-truncated">⚠ Claude 回答達到輸出上限，這次內容可能不完整</small>}
        {response.sources.length > 0 && <small className="model-comparison-sources">來源：{response.sources.join("、")}</small>}
        <div className="model-comparison-meta"><span>{response.usage.inputTokens + response.usage.outputTokens} tokens · {response.usage.durationMs.toLocaleString()} ms</span><span>US$ {response.usage.estimatedCostUsd.toFixed(5)} · NT$ {(response.usage.estimatedCostUsd * 32.5).toFixed(3)}</span></div>
        {!response.error && <label className={`follow-up-check ${selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`) ? "follow-up-selected" : ""}`}><input type="checkbox" checked={selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`)} onChange={() => onToggleFollowUp({ key: `teacher:${messageIndex}:${response.id}:${response.label}`, label: response.label, model: response.model, text: response.text, prompt: pairedPrompt })} /><span>回覆此訊息</span></label>}
        {!response.error && <div className="model-comparison-actions"><label>測試評分<select value={scores[response.id] ?? 0} onChange={(event) => setScores((current) => ({ ...current, [response.id]: Number(event.target.value) }))}><option value={0}>請評分</option>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} 分</option>)}</select></label><button type="button" disabled={!scores[response.id] || saved === response.id} onClick={async () => { await onRate(response.id, "rated", scores[response.id]); setSaved(response.id); }}>送出評分</button><button type="button" className="comparison-preferred" onClick={async () => { await onRate(response.id, "preferred", 5); setSaved(response.id); }}>選這個比較好</button></div>}
        {saved === response.id && <small className="model-comparison-saved">已記錄測試回饋</small>}
      </article>)}
    </div>
  </section>;
}
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [yesterday, setYesterday] = useState<YesterdayContext | null>(null);
  const [dailyChoiceVisible, setDailyChoiceVisible] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [today, setToday] = useState(() => taipeiDate());
  const [greeting, setGreeting] = useState(() => taipeiGreeting());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [railSide, setRailSide] = useState<"left" | "right">("right");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [mobileRailTool, setMobileRailTool] = useState<MobileRailTool>("dictionary");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [source, setSource] = useState<"教材" | "AI 補充" | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [lastUsage, setLastUsage] = useState<ReplyUsage | null>(null);
  const [modelMode, setModelMode] = useState<ChatModelMode>("luna");
  const [settingsPinned, setSettingsPinned] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [generatingStudentReply, setGeneratingStudentReply] = useState(false);
  const [teachingRounds, setTeachingRounds] = useState<TeachingRound[]>([]);
  const [, setTeachingUsage] = useState<EvaluationUsage[]>([]);
  const [selectedFollowUps, setSelectedFollowUps] = useState<FollowUpSelection[]>([]);
  const [evaluatingLevel, setEvaluatingLevel] = useState<TeachingLevel | null>(null);
  const [pendingTeachingLevel, setPendingTeachingLevel] = useState<TeachingLevel | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [editingImage, setEditingImage] = useState(false);
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestion | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState<{ selected: string; correct: boolean; correctAnswer: string } | null>(null);
  const [practiceCoachInput, setPracticeCoachInput] = useState("");
  const [practiceCoachMessages, setPracticeCoachMessages] = useState<PracticeCoachMessage[]>([]);
  const [practiceCoachGap, setPracticeCoachGap] = useState("");
  const [practiceCoachIssue, setPracticeCoachIssue] = useState("");
  const [practiceCoachRecommendations, setPracticeCoachRecommendations] = useState<PracticeRecommendation[]>([]);
  const [practiceCoaching, setPracticeCoaching] = useState(false);
  const practiceCoachEndRef = useRef<HTMLDivElement>(null);
  const [savedMessage, setSavedMessage] = useState<number | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [legalLesson, setLegalLesson] = useState<LegalLesson | null>(null);
  const [dictionaryTerm, setDictionaryTerm] = useState("");
  const [dictionaryResult, setDictionaryResult] = useState<DictionaryResult | null>(null);
  const [dictionaryFeatured, setDictionaryFeatured] = useState<DictionaryResult | null>(null);
  const [dictionaryFeaturedLoading, setDictionaryFeaturedLoading] = useState(false);
  const [dictionaryNotice, setDictionaryNotice] = useState("");
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [musicActivated, setMusicActivated] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [selectedMagazineArticleId, setSelectedMagazineArticleId] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<number | null>(null);
  const handoffHandled = useRef(false);
  const nextExam = useMemo(() => {
    const todayValue = Date.parse(`${today}T00:00:00Z`);
    return (homeFeed?.examCountdowns ?? []).map((exam) => ({ ...exam, days: Math.ceil((Date.parse(`${exam.date}T00:00:00Z`) - todayValue) / 86_400_000) })).filter((exam) => exam.days >= 0).sort((a, b) => a.days - b.days)[0] ?? null;
  }, [homeFeed?.examCountdowns, today]);
  const magazineArticles = homeFeed?.magazine?.articles ?? [];
  const selectedMagazineArticle = magazineArticles.find((article) => article.id === selectedMagazineArticleId) ?? magazineArticles[0] ?? null;
  // The follow-up buttons must use the last completed teacher turn on screen,
  // not whichever model toggle is currently selected. A user may switch from
  // Luna to Sonnet (or from dual to single) after the answer was already shown.
  const latestTeacherIndex = [...messages].map((message, index) => ({ message, index })).reverse().find(({ message }) =>
    message.role === "mentor" && (message.text.trim() || message.comparison?.responses.some((response) => !response.error && response.text.trim())),
  )?.index ?? -1;
  const latestTeacherTurn = latestTeacherIndex >= 0 ? messages[latestTeacherIndex] : null;
  const latestTeacherMessage = latestTeacherTurn && !latestTeacherTurn.comparison ? latestTeacherTurn : null;
  const latestTeacherPrompt = latestTeacherIndex >= 0 ? pairedStudentPrompt(messages, latestTeacherIndex) : "";
  const actualLatestComparison = latestTeacherTurn?.comparison ?? null;
  const latestTeacherModel = latestTeacherMessage?.model ?? lastUsage?.model ?? "gpt-5.6-luna";
  const latestTeacherLabel = modelLabel(latestTeacherModel);
  const latestComparison = actualLatestComparison ?? (latestTeacherMessage ? { id: -1, sourceStatus: "unavailable", responses: [{ id: -1, label: latestTeacherLabel, model: latestTeacherModel, text: latestTeacherMessage.text, source: "AI 補充" as const, sources: latestTeacherMessage.sources ?? [], usage: { inputTokens: lastUsage?.inputTokens ?? 0, cachedTokens: lastUsage?.cachedTokens ?? 0, outputTokens: lastUsage?.outputTokens ?? 0, estimatedCostUsd: lastUsage?.estimatedCostUsd ?? 0, durationMs: 0 } }] } satisfies ModelComparison : null);
  const latestTeacherResponses: ComparisonResponse[] = latestComparison?.responses.filter((response) => !response.error && response.text.trim())
    ?? (latestTeacherMessage ? [{ id: -1, label: latestTeacherLabel, model: latestTeacherModel, text: latestTeacherMessage.text, source: "AI 補充" as const, sources: latestTeacherMessage.sources ?? [], usage: { inputTokens: lastUsage?.inputTokens ?? 0, cachedTokens: lastUsage?.cachedTokens ?? 0, outputTokens: lastUsage?.outputTokens ?? 0, estimatedCostUsd: lastUsage?.estimatedCostUsd ?? 0, durationMs: 0 } }] : []);
  // This is intentionally independent of modelMode. It represents the actual
  // answer(s) immediately above the composer, which is what "超級學霸測試"
  // promises to challenge.
  const canGenerateStudentReply = Boolean(latestTeacherPrompt && latestTeacherResponses.length > 0);
  const evaluatingTeaching = Boolean(evaluatingLevel);
  const selectedFollowUpKeys = selectedFollowUps.map((selection) => selection.key);

  useEffect(() => {
    const refreshTaipeiClock = () => {
      setToday(taipeiDate());
      setGreeting(taipeiGreeting());
    };
    refreshTaipeiClock();
    const timer = window.setInterval(refreshTaipeiClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = input ? `${Math.min(textarea.scrollHeight, 220)}px` : "36px";
  }, [input]);

  useEffect(() => {
    fetch("/api/chat/history").then(async (response) => {
      if (!response.ok) throw new Error("history unavailable");
      const data = await response.json() as { sessionId?: number | null; messages?: Message[]; today?: string; todayTasks?: TodayTask[]; greeting?: string; todayRecords?: TodayRecord[]; yesterday?: YesterdayContext | null };
      setSessionId(data.sessionId ?? null);
      setToday(data.today ?? taipeiDate());
      setTodayTasks(data.todayTasks ?? []);
      setYesterday(data.yesterday ?? null);
      setGreeting(data.greeting ?? taipeiGreeting());
      const restored = data.messages ?? [];
      if (restored.length) setMessages(restored);
      else if (data.yesterday) {
        const incomplete = data.yesterday.incompleteTasks.length;
        const yesterdayProgress = data.yesterday.totalTasks
          ? `昨天完成 ${data.yesterday.completedTasks}/${data.yesterday.totalTasks} 項任務${incomplete ? `，還有 ${incomplete} 項未完成` : ""}`
          : data.yesterday.records.length
            ? `昨天留下 ${data.yesterday.records.length} 筆學習紀錄`
            : "昨天有一段學習對話紀錄";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}。${yesterdayProgress}。今天要怎麼開始，由你決定；我會依昨天的紀錄幫你接續。` }]);
        setDailyChoiceVisible(true);
      }
      else if ((data.todayTasks ?? []).length) {
        const pending = (data.todayTasks ?? []).filter((task) => task.status !== "completed");
      const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: pending.length ? `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天已經安排好 ${pending.length} 項任務。我們從第一項「${pending[0].title}」開始，好嗎？` : `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天的任務都完成了。要不要趁狀態正好，先預習明天的內容？` }]);
      } else {
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}，${recordSummary}我是司律備考的 AI 教練。${records.length ? "我們接著把今天的學習往下推進。" : "今天還沒有安排任務，我可以先根據你的目標與可用時間，幫你建立第一份學習計畫。"}` }]);
      }
    }).catch(() => {
      setMessages([{ role: "mentor", text: `${taipeiGreeting()}，我是司律備考的 AI 教練。今天想從哪一科開始？` }]);
    }).finally(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => { fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed(await response.json() as HomeFeed); }).catch(() => undefined); }, []);
  useEffect(() => { if (magazineArticles.length && !magazineArticles.some((article) => article.id === selectedMagazineArticleId)) setSelectedMagazineArticleId(magazineArticles[0].id); }, [magazineArticles, selectedMagazineArticleId]);
  useEffect(() => { fetch("/api/legal-learning").then(async (response) => { if (response.ok) setLegalLesson(((await response.json()) as { article?: LegalLesson | null }).article ?? null); }).catch(() => undefined); }, []);
  useEffect(() => { fetch("/api/legal-dictionary?random=1").then(async (response) => { if (response.ok) setDictionaryFeatured(await response.json() as DictionaryResult); }).catch(() => undefined); }, []);
  useEffect(() => { practiceCoachEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [practiceCoachMessages, practiceCoaching]);

  useEffect(() => {
    fetch("/api/dashboard").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as DashboardData;
      setDashboard(data);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/usage").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { showCosts?: boolean; showEvidence?: boolean };
      setShowCosts(Boolean(data.showCosts));
      setShowEvidence(Boolean(data.showEvidence));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("silu-command-rail-side");
    if (saved === "left" || saved === "right") setRailSide(saved);
    setRailCollapsed(window.localStorage.getItem("silu-command-rail-collapsed") === "true");
    setSettingsCollapsed(window.localStorage.getItem("silu-ai-settings-collapsed") === "true");
    const pinned = window.localStorage.getItem(aiSettingsStorageKey);
    if (pinned) {
      try {
        const parsed = JSON.parse(pinned) as { teachingLevel?: unknown; modelMode?: unknown };
        if (isTeachingLevel(parsed.teachingLevel) && isChatModelMode(parsed.modelMode)) {
          setSettingsPinned(true);
          setPendingTeachingLevel(parsed.teachingLevel === "general" ? null : parsed.teachingLevel);
          setModelMode(parsed.modelMode);
        } else {
          window.localStorage.removeItem(aiSettingsStorageKey);
        }
      } catch {
        window.localStorage.removeItem(aiSettingsStorageKey);
      }
    }
  }, []);

  function toggleSettingsPinned(next: boolean) {
    setSettingsPinned(next);
    if (!next) {
      window.localStorage.removeItem(aiSettingsStorageKey);
      return;
    }
    window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify({
      teachingLevel: pendingTeachingLevel ?? "general",
      modelMode,
    }));
  }

  function toggleRailSide() {
    const next = railSide === "right" ? "left" : "right";
    setRailSide(next);
    window.localStorage.setItem("silu-command-rail-side", next);
  }

  function toggleRailCollapsed() {
    setRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("silu-command-rail-collapsed", String(next));
      return next;
    });
  }

  function toggleMusic(event: MouseEvent<HTMLButtonElement>) {
    const root = event.currentTarget.closest(".rail-music-card");
    setMusicActivated(true);
    if (musicPlaying) {
      const iframe = root?.querySelector<HTMLIFrameElement>("iframe");
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "stopVideo", args: [] }), "https://www.youtube.com");
      setMusicPlaying(false);
    } else {
      requestYoutubePlay(root);
      setMusicPlaying(true);
    }
  }

  async function startPractice(examType: "mcq" | "essay") {
    setPracticeLoading(true); setPracticeAnswer(null); setPracticeCoachInput(""); setPracticeCoachMessages([]); setPracticeCoachGap(""); setPracticeCoachIssue(""); setPracticeCoachRecommendations([]); setPracticeQuestion(null);
    try {
      const response = await fetch(`/api/practice?type=${examType}`); const result = await response.json() as { question?: PracticeQuestion | null; message?: string };
      if (result.question) setPracticeQuestion(result.question);
      else { setPracticeQuestion(null); setMessages((current) => [...current, { role: "mentor", text: result.message ?? "真題庫尚未準備完成。管理者匯入並確認題目後，我就能從這裡開始帶你練習。" }]); }
    } finally { setPracticeLoading(false); }
  }

  function askMagazineArticle(article: MagazineArticle) {
    void send(`請帶我學習月旦法學教室的文章「${article.title}」。\n摘要：${article.summary || "尚未完成摘要。"}\n核心爭點：${article.issue || "尚未擷取到核心爭點，請先從文章標題辨認並清楚標示推測。"}\n請以這個爭點為核心，先說明判斷分岔，再問我一個可以直接回答的小問題。`);
  }

  function teachLegalLesson() {
    if (!legalLesson) return;
    void send(`請帶我學習這條法條：\n${legalLesson.title} ${legalLesson.articleNo}\n${legalLesson.content}\n請先用一句話說明考點，再用一個生活化或司律題型情境問我；不要一開始就給完整答案。`);
  }

  async function loadRandomLegalLesson() {
    const response = await fetch("/api/legal-learning?random=1");
    if (!response.ok) return;
    const result = await response.json() as { article?: LegalLesson | null };
    if (result.article) setLegalLesson(result.article);
  }

  async function searchDictionary(event: FormEvent) {
    event.preventDefault();
    const term = dictionaryTerm.trim();
    if (!term) return;
    setDictionaryLoading(true);
    setDictionaryNotice("");
    setDictionaryResult(null);
    const response = await fetch(`/api/legal-dictionary?q=${encodeURIComponent(term)}`);
    const result = await response.json() as DictionaryResult & { error?: string; canExplainWithAi?: boolean };
    if (response.ok) setDictionaryResult(result);
    else setDictionaryNotice(`${result.error ?? "目前查不到這個名詞"}${result.canExplainWithAi ? " 點下方「AI 解釋」即可接續。" : ""}`);
    setDictionaryLoading(false);
  }

  async function loadRandomDictionary() {
    setDictionaryFeaturedLoading(true);
    try {
      const response = await fetch("/api/legal-dictionary?random=1");
      if (response.ok) setDictionaryFeatured(await response.json() as DictionaryResult);
    } finally {
      setDictionaryFeaturedLoading(false);
    }
  }

  function teachDictionaryTerm() {
    if (!dictionaryResult) return;
    void send(`請用司律考生能理解的方式教我法律名詞「${dictionaryResult.term}」。\n${dictionaryResult.sourceLabel}內容：\n${dictionaryResult.content}\n請先說明白話意思，再補充它常出現在哪一科、容易和什麼概念混淆，最後問我一個判斷題。若資料來源已停止更新，請提醒我核對現行法令。`);
  }

  function teachUnknownDictionaryTerm() {
    const term = dictionaryTerm.trim();
    if (!term) return;
    void send(`目前司法院裁判書用語辭典與法律百科都沒有找到「${term}」的詞條。請不要假裝有外部來源，改以中華民國法律學習脈絡，清楚標示「AI 整理」，用白話說明這個名詞可能的法律意義；若有不確定之處請明確說明，並提醒我核對法條與判決原文。最後問我一個簡短判斷題。`);
  }

  function teachFeaturedDictionaryTerm() {
    if (!dictionaryFeatured) return;
    void send(`請用司律考生能理解的方式教我法律名詞「${dictionaryFeatured.term}」。\n司法院裁判書用語辭典內容：\n${dictionaryFeatured.content}\n請先說明白話意思，再補充它常出現在哪一科、容易和什麼概念混淆，最後問我一個判斷題。`);
  }

  function recommendationUrl(item: PracticeRecommendation) {
    if (!item.url || item.startSeconds == null) return item.url;
    try {
      const url = new URL(item.url);
      if (url.hostname === "youtu.be") url.searchParams.set("t", String(item.startSeconds));
      else if (url.hostname.includes("youtube.com")) url.searchParams.set("t", `${item.startSeconds}s`);
      else url.hash = `t=${item.startSeconds}`;
      return url.toString();
    } catch { return item.url; }
  }

  async function askPracticeCoach() {
    if (!practiceQuestion || practiceCoaching || !practiceCoachInput.trim()) return;
    const studentMessage = { role: "student" as const, text: practiceCoachInput.trim() };
    const messagesForRequest = [...practiceCoachMessages, studentMessage];
    setPracticeCoachMessages(messagesForRequest);
    setPracticeCoachInput("");
    setPracticeCoaching(true);
    try {
      const response = await fetch("/api/practice-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: practiceQuestion.id, selectedAnswer: practiceAnswer?.selected ?? null, messages: messagesForRequest }) });
      const result = await response.json() as { reply?: string; diagnosedGap?: string; keyIssue?: string; recommendations?: PracticeRecommendation[]; error?: string };
      setPracticeCoachMessages((current) => [...current, { role: "mentor", text: result.reply ?? result.error ?? "教練暫時無法接續，請稍後再試。" }]);
      if (response.ok) {
        setPracticeCoachGap(result.diagnosedGap ?? "");
        setPracticeCoachIssue(result.keyIssue ?? "");
        setPracticeCoachRecommendations(result.recommendations ?? []);
      }
    } finally {
      setPracticeCoaching(false);
    }
  }

  function beginEssayCoach() {
    setPracticeCoachMessages([{ role: "mentor", text: "先不要急著寫完整答案。請先說出本題的人物、行為、時間，以及你看到的第一個法律爭點。" }]);
  }

  async function answerMcq(answer: string) {
    if (!practiceQuestion || practiceAnswer) return;
    const response = await fetch("/api/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: practiceQuestion.id, answer }) });
    const result = await response.json() as { correct?: boolean; correctAnswer?: string; guidance?: string; error?: string };
    if (!response.ok || typeof result.correct !== "boolean" || !result.correctAnswer) return;
    setPracticeAnswer({ selected: answer, correct: result.correct, correctAnswer: result.correctAnswer });
    setPracticeCoachMessages([{ role: "mentor", text: result.guidance ?? "先說說你的判斷理由，我們再逐一檢查其他選項。" }]);
  }

  function chooseQuestionImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { setImageDraft({ url: String(reader.result), name: file.name, rotation: 0, enhance: false, points: [{ x: 4, y: 4 }, { x: 50, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 50, y: 96 }, { x: 4, y: 96 }] }); setEditingImage(true); };
    reader.readAsDataURL(file);
  }

  function moveCropPoint(index: number, clientX: number, clientY: number) {
    const rect = editorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100)) };
    setImageDraft((current) => current ? { ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? point : item) } : current);
  }

  async function prepareQuestionImage(draft: ImageDraft) {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = draft.url; });
    const xs = draft.points.map((point) => point.x / 100 * source.naturalWidth);
    const ys = draft.points.map((point) => point.y / 100 * source.naturalHeight);
    const minX = Math.max(0, Math.min(...xs)); const maxX = Math.min(source.naturalWidth, Math.max(...xs));
    const minY = Math.max(0, Math.min(...ys)); const maxY = Math.min(source.naturalHeight, Math.max(...ys));
    const cropWidth = Math.max(1, maxX - minX); const cropHeight = Math.max(1, maxY - minY);
    const scale = Math.min(1, 1600 / Math.max(cropWidth, cropHeight));
    const cropped = document.createElement("canvas"); cropped.width = Math.round(cropWidth * scale); cropped.height = Math.round(cropHeight * scale);
    const context = cropped.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, cropped.width, cropped.height); context.save(); context.beginPath();
    draft.points.forEach((point, index) => { const x = (point.x / 100 * source.naturalWidth - minX) * scale; const y = (point.y / 100 * source.naturalHeight - minY) * scale; index ? context.lineTo(x, y) : context.moveTo(x, y); });
    context.closePath(); context.clip(); context.filter = draft.enhance ? "contrast(1.28) brightness(1.06) saturate(.82)" : "none"; context.drawImage(source, -minX * scale, -minY * scale, source.naturalWidth * scale, source.naturalHeight * scale); context.restore();
    const turns = ((draft.rotation % 360) + 360) % 360; if (!turns) return cropped.toDataURL("image/jpeg", .78);
    const rotated = document.createElement("canvas"); const swap = turns === 90 || turns === 270; rotated.width = swap ? cropped.height : cropped.width; rotated.height = swap ? cropped.width : cropped.height;
    const rotatedContext = rotated.getContext("2d")!; rotatedContext.fillStyle = "white"; rotatedContext.fillRect(0, 0, rotated.width, rotated.height); rotatedContext.translate(rotated.width / 2, rotated.height / 2); rotatedContext.rotate(turns * Math.PI / 180); rotatedContext.drawImage(cropped, -cropped.width / 2, -cropped.height / 2);
    return rotated.toDataURL("image/jpeg", .78);
  }

  async function send(text: string) {
    composerInputRef.current?.blur();
    const value = text.trim();
    if ((!value && !imageDraft) || thinking) return;
    const sentTeachingLevel = pendingTeachingLevel;
    const question = value || "請先辨識這張圖片中的題目，帶我一步一步審題。";
    const attachedImage = imageDraft ? await prepareQuestionImage(imageDraft) : undefined;
    const nextMessages: Message[] = [...messages, { role: "student", text: imageDraft ? `📷 ${question}` : question }];
    setMessages(nextMessages);
    if (!sentTeachingLevel) setTeachingRounds([]);
    if (!sentTeachingLevel) setTeachingUsage([]);
    setSelectedFollowUps([]);
    if (!settingsPinned) setPendingTeachingLevel(null);
    setInput("");
    setDailyChoiceVisible(false);
    setImageDraft(null);
    setEditingImage(false);
    setSettingsCollapsed(true);
    window.localStorage.setItem("silu-ai-settings-collapsed", "true");
    setThinking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12), sessionId, imageDataUrl: attachedImage, modelMode, teachingLevel: sentTeachingLevel }),
      });
      const result = await response.json() as { reply?: string; source?: "教材" | "AI 補充"; sources?: string[]; citationStatus?: string; teachingEvidence?: TeachingEvidence | null; usage?: ReplyUsage; sessionId?: number; error?: string; comparison?: ModelComparison | null };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "對話暫時無法使用");
      setMessages((current) => [...current, { role: "mentor", text: result.reply!, model: result.usage?.model, usage: result.usage, sources: result.sources ?? [], citationStatus: result.citationStatus, teachingEvidence: result.teachingEvidence, comparison: result.comparison ?? undefined }]);
      setSource(result.source ?? "AI 補充");
      setLastUsage(result.usage ?? null);
      if (sentTeachingLevel) {
        const lunaResponse = result.comparison?.responses.find((item) => item.label === "Luna") ?? null;
        const claudeResponse = result.comparison?.responses.find((item) => item.label === "Claude Sonnet") ?? null;
        const primaryLabel = modelLabel(result.usage?.model ?? "");
        const teacherA = {
          label: primaryLabel,
          model: lunaResponse?.model ?? result.usage?.model ?? "gpt-5.6-luna",
          text: result.reply!,
          usage: lunaResponse?.usage ?? { model: result.usage?.model ?? "gpt-5.6-luna", inputTokens: result.usage?.inputTokens ?? 0, cachedTokens: result.usage?.cachedTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0, estimatedCostUsd: result.usage?.estimatedCostUsd ?? 0, durationMs: 0 },
          stopReason: lunaResponse?.stopReason ?? null,
        };
        const teacherB = claudeResponse ? { label: "Claude Sonnet", model: claudeResponse.model, text: claudeResponse.text, usage: claudeResponse.usage, stopReason: claudeResponse.stopReason ?? null } : undefined;
        setTeachingRounds((current) => [...current.filter((item) => item.level !== sentTeachingLevel), { level: sentTeachingLevel, label: teachingLevelLabels[sentTeachingLevel], reply: question, teacherA, teacherB }]);
        setTeachingUsage((current) => [...current, ...(result.comparison?.responses ?? []).map((item) => ({ model: item.model, inputTokens: item.usage.inputTokens, cachedTokens: item.usage.cachedTokens, outputTokens: item.usage.outputTokens, durationMs: item.usage.durationMs, estimatedCostUsd: item.usage.estimatedCostUsd }))]);
      }
      if (result.sessionId) setSessionId(result.sessionId);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "mentor",
        text: error instanceof Error && error.message ? error.message : "對話暫時無法使用；請稍後再試。",
      }]);
    } finally {
      setThinking(false);
    }
  }

  function runAnswerAction(action: AnswerAction, selection: { label: string; model: string; text: string; prompt: string; excerpts: string[] }) {
    if (thinking) return;
    const excerpt = selection.excerpts.join("\n\n").slice(0, 9000);
    const subject = action === "plain" ? "白話解釋" : action === "detailed" ? "詳解解析" : "延伸追問";
    const instruction = action === "plain"
      ? "請把這段回答改用法律初學者也能理解的白話說明。先說核心意思，再用一個生活化但法律上不失真的例子；不要省略重要法律條件。"
      : action === "detailed"
        ? "請針對這段回答做詳解解析。逐層說明爭點、規範依據、要件、涵攝、結論，以及這段回答容易被誤解或漏寫的地方；若涉及教材或法條，請只在確實有依據時引用。"
        : "請針對這段回答提出一個能繼續推進理解的追問，先不要直接公布完整答案；問題要讓學生可以直接回答。";
    void send(`請針對老師${selection.label ? `（${selection.label}）` : ""}回答中的以下內容，進行「${subject}」。\n\n【選取內容】\n${excerpt}\n\n【處理要求】\n${instruction}`);
  }

  async function rateComparison(responseId: number, feedbackType: "preferred" | "rated", score: number) {
    await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comparisonResponseId: responseId, feedbackType, score }),
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  async function startNewTopic() {
    if (thinking || generatingStudentReply || evaluatingTeaching) return;
    try {
      const response = await fetch("/api/chat/new-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const result = await response.json() as { sessionId?: number; greeting?: string; error?: string };
      if (!response.ok || !result.sessionId) throw new Error(result.error ?? "目前無法開啟新主題");
      setSessionId(result.sessionId);
      setMessages([{ role: "mentor", text: result.greeting ?? "新主題已經準備好了。這次要從哪一個問題開始？" }]);
      setInput("");
      setSource(null);
      setLastUsage(null);
      setTeachingRounds([]);
      setTeachingUsage([]);
      setSelectedFollowUps([]);
      if (!settingsPinned) setPendingTeachingLevel(null);
      setImageDraft(null);
      setEditingImage(false);
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    } catch (error) {
      setMessages((current) => [...current, { role: "mentor", text: error instanceof Error ? error.message : "目前無法開啟新主題，原對話仍然保留。" }]);
    }
  }

  function insertStudentTestPrompt() {
    if (thinking || generatingStudentReply) return;
    setInput(trustPrincipleStudentTest);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function teachingStarterPrompt(level: Exclude<TeachingLevel, "general">) {
    const prefix: Record<Exclude<TeachingLevel, "general">, string> = {
      beginner: "我是法律小白，請把我當成第一次接觸這個爭點的學生，",
      intermediate: "我是基礎考生，我知道一些基本概念但常常不會涵攝，",
      advanced: "我是進階考生，想檢驗學說與實務分歧，",
      super: "我是頂尖學霸，想做高難度的體系與反例測試，",
    };
    return `${prefix[level]}請用信賴原則舉一個司律考試會考的情境，先不要直接公布完整答案，請先問我一個可以回答的問題。`;
  }

  function toggleFollowUpSelection(selection: FollowUpSelection) {
    setSelectedFollowUps((current) => current.some((item) => item.key === selection.key) ? [] : [selection]);
  }

  async function generateStudentFollowUp(level?: TeachingLevel) {
    if (thinking || generatingStudentReply) return;
    // React click handlers receive a SyntheticEvent as their first argument.
    // Keep UI events out of the JSON request even if this function is passed
    // directly to a handler by mistake.
    const requestedLevel: TeachingLevel | undefined =
      level === "beginner" || level === "intermediate" || level === "advanced" || level === "super" ? level : undefined;
    if (!canGenerateStudentReply) {
      if (requestedLevel) {
        setPendingTeachingLevel(requestedLevel);
        setInput(teachingStarterPrompt(requestedLevel));
        window.setTimeout(() => composerInputRef.current?.focus(), 0);
      } else {
        insertStudentTestPrompt();
      }
      return;
    }
    const followUpResponses = selectedFollowUps.length > 0 ? selectedFollowUps : latestTeacherResponses.map((item) => ({ key: `latest:${item.id}:${item.label}`, label: item.label, model: item.model, text: item.text, prompt: latestTeacherPrompt }));
    const followUpPrompt = followUpResponses.map((item) => item.prompt).filter(Boolean).filter((prompt, index, all) => all.indexOf(prompt) === index).join("\n\n") || latestTeacherPrompt;
    setGeneratingStudentReply(true);
    setEvaluatingLevel(level ?? null);
    try {
      const response = await fetch("/api/chat/student-follow-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: followUpPrompt,
          level: requestedLevel,
          responses: followUpResponses.map((item) => ({ label: item.label, model: item.model, text: item.excerpt ? `老師回答中被勾選的段落：\n${item.excerpt}` : item.text })),
        }),
      });
      const result = await response.json() as { reply?: string; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "目前無法產生同學接續回覆");
      setPendingTeachingLevel(requestedLevel ?? null);
      setInput(result.reply);
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    } catch (error) {
      setMessages((current) => [...current, { role: "mentor", text: error instanceof Error ? error.message : "目前無法產生同學接續回覆。" }]);
    } finally {
      setGeneratingStudentReply(false);
      setEvaluatingLevel(null);
    }
  }

  // 程度按鈕沿用「依老師回覆生成同學回覆」的互動：只把學生訊息放進輸入框，
  // 不在下方直接產生教師解析；送出時才由目前選定的模型回答。
  async function runTeachingLevel(level: TeachingLevel) {
    await generateStudentFollowUp(level);
  }

  function selectTeachingLevel(value: string) {
    const level = value as TeachingLevel;
    if (level === "general") {
      setPendingTeachingLevel(null);
      return;
    }
    setPendingTeachingLevel(level);
  }

  useEffect(() => {
    if (!historyLoaded || handoffHandled.current) return;
    const prompt = new URLSearchParams(window.location.search).get("prompt")?.trim();
    if (!prompt) return;
    handoffHandled.current = true;
    window.history.replaceState({}, "", "/");
    void send(prompt);
  }, [historyLoaded]);

  async function saveMessageNote(message: Message, index: number) {
    const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceType: "conversation", sourceId: sessionId ? `${sessionId}-${index}` : String(index), title: cleanMessageText(message.text).slice(0, 32), content: cleanMessageText(message.text), subject: todayTasks.find((task) => task.status !== "completed")?.subject ?? "綜合", tags: "AI對話", sourceLabel: message.sources?.join("、") ?? "" }) });
    if (response.ok) { setSavedMessage(index); window.setTimeout(() => setSavedMessage(null), 1600); }
  }

  async function sendFeedback(message: Message, index: number, feedbackType: "helpful" | "incorrect" | "not_learning" | "unclear") {
    const response = await fetch("/api/chat/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, messageIndex: index, feedbackType, messageText: cleanMessageText(message.text) }) });
    if (response.ok) { setFeedbackMessage(index); window.setTimeout(() => setFeedbackMessage(null), 1600); }
  }

  return (
    <main className="coach-shell">
      <header className="topbar">
        <div className="brand-zone"><a href="/" className="brand" aria-label="司律備考首頁"><span className="brand-mark">律</span><span>司律備考</span></a>{nextExam ? <div className="exam-countdown" aria-label={`距離${nextExam.label}還有${nextExam.days}天`}><span>距離 {nextExam.label}</span><strong>{nextExam.days === 0 ? "就是今天" : `${nextExam.days} 天`}</strong></div> : null}</div>
        <div className="top-actions">
          <a href="/model-lab" className="admin-link">模型盲測</a>
          <a href="/review" className="admin-link review-entry-link">司律評</a>
          <a href="/plan" className="admin-link">學習專區</a>
          <a href="/admin" className="admin-link">管理後台</a>
        </div>
      </header>
      <div className="study-ticker" aria-label="司律作戰快訊"><strong>作戰快訊</strong><div><span>{(homeFeed?.ticker?.length ? homeFeed.ticker : [{ id: "default", text: "今日任務完成後，記得留下學習接續點", url: "", enabled: true }]).map((item, index) => <span className="ticker-item" key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.text}</a> : item.text}{index < (homeFeed?.ticker?.length || 1) - 1 ? <b>◆</b> : null}</span>)}</span></div></div>

      <div className="home-date-line" aria-label={`${greeting}，今天日期`}><span>今天｜{dateLabel(today)}</span>{legalLesson ? <div className="daily-law-actions"><button type="button" className="daily-law-button" onClick={teachLegalLesson}><b>法條學習</b><span>{legalLesson.title} {legalLesson.articleNo}</span></button><button type="button" className="daily-law-swap" onClick={() => void loadRandomLegalLesson()}>換法條</button></div> : <span className="daily-law-pending"><b>法條學習</b><span>全國法規匯入後，點擊隨機學習</span></span>}<section className="practice-inline-launch" aria-label="練真題"><strong>練真題</strong><div><button type="button" onClick={() => startPractice("mcq")} disabled={practiceLoading}>一試選擇題</button><button type="button" onClick={() => startPractice("essay")} disabled={practiceLoading}>二試申論題</button></div></section></div>

      {practiceQuestion && <button
        type="button"
        className={`mobile-rail-toggle mobile-rail-toggle-practice rail-${railSide}`}
        onClick={() => setMobileRailOpen(true)}
        aria-expanded={mobileRailOpen}
        aria-controls="command-rail"
      >
        <span aria-hidden="true">工具</span>
        <b>學習工具</b>
      </button>}
      {mobileRailOpen && <button type="button" className="mobile-rail-backdrop" aria-label="關閉作戰資訊側欄" onClick={() => setMobileRailOpen(false)} />}

      <div className={`command-layout rail-${railSide} ${railCollapsed ? "rail-collapsed" : ""} ${mobileRailOpen ? "mobile-rail-open" : ""}`}>
      <section className="conversation" aria-live="polite">
        <div className="conversation-heading">
          <p>AI 司律作戰中心</p>
          <h1>今天，照計畫前進。</h1>
          <span>我會讀取你的計畫、進度與教材，接著上次的地方帶你學。</span>
          <button type="button" className="desktop-rail-toggle" onClick={toggleRailCollapsed} aria-expanded={!railCollapsed} aria-controls="command-rail">
            {railCollapsed ? "展開學習工具" : "收合側欄"}
          </button>
        </div>
        {todayTasks.length > 0 && <details className="today-plan-card">
          <summary><div><b>今日任務</b><span>{todayTasks.filter((task) => task.status === "completed").length}/{todayTasks.length} 完成 · {todayTasks.find((task) => task.status !== "completed")?.title ?? "今日任務已完成"}</span></div><em>展開</em></summary>
          <div className="today-plan-head"><div><p>今日學習計畫</p><strong>{today || "今天"}</strong></div><Link href="/plan">查看行事曆 →</Link></div>
          <div className="today-task-list">{todayTasks.map((task) => <div className={`today-task ${task.status === "completed" ? "done" : ""}`} key={task.id}><span>{task.status === "completed" ? "✓" : ""}</span><div><strong>{task.subject} · {task.title}</strong><small>{task.durationMinutes} 分鐘{task.details ? ` · ${task.details}` : ""}</small></div></div>)}</div>
          {todayTasks.some((task) => task.status !== "completed") && <button onClick={() => send(`請直接帶我開始今天第一個尚未完成的任務：${todayTasks.find((task) => task.status !== "completed")?.title}`)}>開始今日第一項</button>}
        </details>}

        {practiceQuestion && <section className="practice-card" aria-label="對話中的真題教練">
          <div className="practice-meta"><span>{practiceQuestion.examType === "mcq" ? "一試選擇題" : "二試申論題"}</span><strong>{practiceQuestion.year} · {practiceQuestion.subject} · 第 {practiceQuestion.questionNumber} 題</strong><button onClick={() => setPracticeQuestion(null)}>收起</button></div>
          <p className="practice-stem">{practiceQuestion.stem}</p>
          {practiceQuestion.examType === "mcq" && practiceQuestion.options ? <div className="option-grid">{["A", "B", "C", "D"].filter((key) => practiceQuestion.options?.[key]).map((key) => { const selected = practiceAnswer?.selected === key; const correct = practiceAnswer?.correctAnswer === key; return <button className={`${selected ? "selected" : ""} ${practiceAnswer && correct ? "correct" : ""} ${practiceAnswer && selected && !practiceAnswer.correct ? "wrong" : ""}`} disabled={Boolean(practiceAnswer)} onClick={() => answerMcq(key)} key={key}><b>{key}</b><span>{practiceQuestion.options?.[key]}</span></button>; })}</div> : <button className="essay-start" onClick={beginEssayCoach}>開始學審題</button>}
          {practiceAnswer && <div className={`answer-result ${practiceAnswer.correct ? "correct" : "wrong"}`}><strong>{practiceAnswer.correct ? "答對了" : "再想一步"}</strong><span>正確答案：{practiceAnswer.correctAnswer}。請在下方直接回答教練。</span></div>}
          {practiceCoachMessages.length > 0 && <section className="practice-coach home-practice-coach">
            <header><div><span>真題教練</span><h3>直接在這道題裡回答</h3></div></header>
            <div className="practice-coach-messages">{practiceCoachMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "mentor" ? "教練" : "我"}</b><p>{message.text}</p></div>)}<div ref={practiceCoachEndRef} /></div>
            {(practiceCoachIssue || practiceCoachGap) && <div className="practice-diagnosis">{practiceCoachIssue && <p><b>核心爭點</b>{practiceCoachIssue}</p>}{practiceCoachGap && <p><b>需要加強</b>{practiceCoachGap}</p>}</div>}
            <form onSubmit={(event) => { event.preventDefault(); void askPracticeCoach(); }}><textarea value={practiceCoachInput} onChange={(event) => setPracticeCoachInput(event.target.value)} placeholder="直接回答教練的問題；不知道也可以說卡在哪裡" rows={2} /><button disabled={practiceCoaching || !practiceCoachInput.trim()}>{practiceCoaching ? "教練思考中…" : "送出回答"}</button></form>
            {practiceCoachRecommendations.length > 0 && <div className="practice-recommendations"><strong>依這題推薦補強</strong><div>{practiceCoachRecommendations.map((item, index) => <article key={`${item.type}-${item.title}-${index}`}><span>{item.type === "law" ? "法條" : item.type === "course" ? "影音" : "教材"}</span><b>{item.title}</b><p>{item.location}</p>{item.url && <a href={recommendationUrl(item)} target="_blank" rel="noreferrer">{item.type === "course" && item.startSeconds != null ? "跳到這個時間點 ↗" : "開啟內容 ↗"}</a>}</article>)}</div></div>}
          </section>}
        </section>}

        {!practiceQuestion && <div className="message-list" ref={messageListRef}>
          {!historyLoaded && <div className="message-row mentor"><span className="mentor-avatar">律</span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === "mentor" && <span className="mentor-avatar">律</span>}
              <div className="message-bubble">{message.comparison ? <ModelComparisonCard comparison={message.comparison} messageIndex={index} pairedPrompt={pairedStudentPrompt(messages, index)} selectedKeys={selectedFollowUpKeys} onRate={rateComparison} onToggleFollowUp={toggleFollowUpSelection} onAnswerAction={runAnswerAction} thinking={thinking} /> : <>{message.role === "mentor" ? <MentorAnswerText text={message.text} label={modelLabel(message.model ?? "gpt-5.6-luna")} model={message.model ?? "gpt-5.6-luna"} prompt={pairedStudentPrompt(messages, index)} onAnswerAction={runAnswerAction} disabled={thinking} showLearningActions={false} /> : <span className="message-text">{cleanMessageText(message.text)}</span>}{message.role === "mentor" && message.usage ? <small className="message-usage"><b>{message.usage.model.replace("gpt-5.6-", "")}</b><span>輸入 {message.usage.inputTokens.toLocaleString()} · 輸出 {message.usage.outputTokens.toLocaleString()} · 合計 {(message.usage.inputTokens + message.usage.outputTokens).toLocaleString()} tokens</span><span>耗時 {message.usage.durationMs.toLocaleString()} ms · US$ {message.usage.estimatedCostUsd.toFixed(5)} · 約 NT$ {formatTwd(message.usage.estimatedCostUsd)}</span></small> : null}{message.role === "mentor" && message.sources?.length ? <small className="message-sources">教材來源：{message.sources.join("、")} · {citationStatusLabel(message.citationStatus)}</small> : message.role === "mentor" && message.citationStatus ? <small className="message-sources">{citationStatusLabel(message.citationStatus)}</small> : null}</>}{message.role === "mentor" && <div className="message-actions">{!message.comparison && <label className={`follow-up-check message-follow-up-check ${selectedFollowUpKeys.includes(`teacher:${index}`) ? "follow-up-selected" : ""}`}><input type="checkbox" checked={selectedFollowUpKeys.includes(`teacher:${index}`)} onChange={() => toggleFollowUpSelection({ key: `teacher:${index}`, label: modelLabel(message.model ?? "gpt-5.6-luna"), model: message.model ?? "gpt-5.6-luna", text: message.text, prompt: pairedStudentPrompt(messages, index) })} /><span>回覆此訊息</span></label>}{isLearningNote(message.text) && <button className="save-note-button" onClick={() => saveMessageNote(message, index)}>{savedMessage === index ? "已收藏 ✓" : "收藏筆記"}</button>}<details className="feedback-menu"><summary>{feedbackMessage === index ? "已收到 ✓" : "回饋"}</summary><div><button onClick={() => sendFeedback(message, index, "helpful")}>有幫助</button><button onClick={() => sendFeedback(message, index, "incorrect")}>內容有誤</button><button onClick={() => sendFeedback(message, index, "unclear")}>不夠清楚</button><button onClick={() => sendFeedback(message, index, "not_learning")}>非學習內容</button></div></details></div>}</div>
              {message.role === "mentor" && showEvidence && <TeachingEvidenceDetails evidence={message.teachingEvidence} />}
            </div>
          ))}
          {!thinking && dailyChoiceVisible && yesterday && messages.at(-1)?.role === "mentor" && <section className="daily-handoff" aria-label="昨日學習接續選擇">
            <div><b>今天要怎麼接續？</b><span>{yesterday.incompleteTasks.length ? `昨天還有 ${yesterday.incompleteTasks.length} 項未完成` : "昨天的學習紀錄已保存"}</span></div>
            <div className="daily-handoff-actions">
              <button type="button" onClick={() => void send("我想繼續昨天的進度，請先告訴我昨天完成到哪裡，再從未完成的任務或最後接續點開始。")}>繼續昨天進度</button>
              <button type="button" onClick={() => void send("我今天想開始新的單元，請依照今天的任務直接帶我開始。")}>開始今天新單元</button>
              <button type="button" onClick={() => void send("請考考我昨天的學習成效，先出一個我可以直接回答的小問題，不要先公布答案。")}>考考昨天成效</button>
            </div>
          </section>}
          {thinking && (
            <div className="message-row mentor">
              <span className="mentor-avatar">律</span>
              <div className="message-bubble typing"><i /><i /><i /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>}

        {!practiceQuestion && source && <div className="answer-source">本次回答：{source === "教材" ? "依平台教材整理" : "平台教材未命中，使用 AI 一般知識補充"}{showCosts && lastUsage ? <span className="frontend-cost"> · {lastUsage.model.replace("gpt-5.6-", "")} · {lastUsage.inputTokens + lastUsage.outputTokens} tokens · US$ {lastUsage.estimatedCostUsd.toFixed(5)} · 約 NT$ {formatTwd(lastUsage.estimatedCostUsd)}</span> : null}</div>}

        {!practiceQuestion && historyLoaded && messages.length === 1 && (
          <div className="quick-starts">
            {quickStarts.map((item) => (
              <button key={item} onClick={() => send(item)}>{item}</button>
            ))}
          </div>
        )}
      </section>

      <aside className="command-rail" id="command-rail" aria-label="作戰資訊側欄">
        <div className="mobile-rail-head">
          <strong>學習工具</strong>
          <div>
            <button type="button" onClick={toggleRailSide}>⇆ 移到{railSide === "right" ? "左側" : "右側"}</button>
            <button type="button" onClick={() => setMobileRailOpen(false)} aria-label="關閉作戰資訊側欄">關閉</button>
          </div>
        </div>
        <nav className="mobile-rail-tabs" aria-label="切換學習工具">
          {([
            ["dictionary", "法典"],
            ["listening", "聽解題"],
            ["magazine", "讀法教"],
            ["music", "音樂"],
          ] as Array<[MobileRailTool, string]>).map(([tool, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={mobileRailTool === tool}
              className={mobileRailTool === tool ? "active" : ""}
              onClick={() => setMobileRailTool(tool)}
              key={tool}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="rail-switch" onClick={toggleRailSide} aria-label={`將作戰資訊移到${railSide === "right" ? "左" : "右"}側`}>⇆ 移到{railSide === "right" ? "左邊" : "右邊"}</button>
        <section className={`top-dictionary-card rail-dictionary-card mobile-rail-panel ${mobileRailTool === "dictionary" ? "mobile-active" : ""}`} aria-label="法律辭典">
          <div className="top-dictionary-intro"><div className="rail-title"><strong>法律辭典</strong><a href="https://terms.judicial.gov.tw/" target="_blank" rel="noreferrer">司法院來源 ↗</a></div><p>查一個法律名詞，或讓 AI 隨機抽一個司律常見用語。</p></div>
          {dictionaryFeatured && <div className="top-dictionary-featured"><div><span>AI 今日隨機</span><strong>{dictionaryFeatured.term}</strong></div><p>{dictionaryFeatured.content}</p><div><button type="button" onClick={teachFeaturedDictionaryTerm}>讓 AI 教我</button><button type="button" onClick={() => void loadRandomDictionary()} disabled={dictionaryFeaturedLoading}>{dictionaryFeaturedLoading ? "換題中…" : "換一個"}</button></div></div>}
          <div className="top-dictionary-search"><form onSubmit={searchDictionary}><input value={dictionaryTerm} onChange={(event) => setDictionaryTerm(event.target.value)} placeholder="例如：比例原則、抗告、系爭" aria-label="輸入法律名詞" /><button disabled={dictionaryLoading}>{dictionaryLoading ? "查詢中…" : "查辭典"}</button></form>{dictionaryNotice && <small className="dictionary-notice">{dictionaryNotice}</small>}{dictionaryResult && <div className="dictionary-result"><div className="dictionary-result-heading"><strong>{dictionaryResult.term}</strong><span>{dictionaryResult.sourceLabel}</span></div><p>{dictionaryResult.content}</p>{dictionaryResult.sourceNote && <small className="dictionary-source-note">{dictionaryResult.sourceNote}</small>}<div className="dictionary-result-actions"><a href={dictionaryResult.sourceUrl} target="_blank" rel="noreferrer" aria-label={`查看${dictionaryResult.term}完整詞條`}>看全文</a><button type="button" onClick={teachDictionaryTerm}>白話解析</button></div></div>}{dictionaryNotice && !dictionaryResult && dictionaryTerm.trim() && <div className="dictionary-result dictionary-ai-fallback"><div className="dictionary-result-heading"><strong>{dictionaryTerm.trim()}</strong><span>AI 整理</span></div><p>外部詞典目前沒有可引用的詞條；可以請 AI 依司律考試脈絡先做白話說明。</p><div className="dictionary-result-actions"><a href="https://terms.judicial.gov.tw/" target="_blank" rel="noreferrer">司法院詞典</a><button type="button" onClick={teachUnknownDictionaryTerm}>AI 解釋</button></div></div>}</div>
        </section>
        <article className={`home-editorial-card rail-editorial-card mobile-rail-panel ${mobileRailTool === "listening" ? "mobile-active" : ""}`}><div className="column-kicker">LISTENING SOLUTION</div><div className="home-editorial-head"><div><h2>聽解題專區</h2><span>{homeFeed?.listening ? `${homeFeed.listening.year} · ${homeFeed.listening.subject}` : "把解題變成可以反覆聽的學習段落"}</span></div><i>{homeFeed?.listening ? "▶" : "聽"}</i></div>{homeFeed?.listening ? <><p>先聽老師抓爭點，再回學習專區接續今天的題目。</p><ListeningPlayer item={homeFeed.listening} compact /></> : <p className="column-empty">後台尚未發布可播放的聽解題音檔。</p>}</article>
        <article className={`home-editorial-card rail-editorial-card rail-magazine-card mobile-rail-panel ${mobileRailTool === "magazine" ? "mobile-active" : ""}`}><div className="column-kicker">LAW CLASSROOM</div><div className="home-editorial-head"><div><h2>讀法教</h2><span>切換文章，再按「爭點解析」學習核心爭點</span></div><i>法</i></div>{homeFeed?.magazine ? <><strong>{homeFeed.magazine.title}</strong>{magazineArticles.length > 1 ? <div className="magazine-tabs" role="tablist" aria-label="法學教室文章切換">{magazineArticles.map((article, index) => <button type="button" role="tab" aria-selected={selectedMagazineArticle?.id === article.id} className={selectedMagazineArticle?.id === article.id ? "active" : ""} onClick={() => setSelectedMagazineArticleId(article.id)} key={article.id}>{index + 1}</button>)}</div> : null}{selectedMagazineArticle ? <div className="magazine-article-panel" role="tabpanel"><div className="magazine-article-copy"><h3>{selectedMagazineArticle.title}</h3>{selectedMagazineArticle.summary && <p className="magazine-article-summary"><b>摘要</b>{selectedMagazineArticle.summary}</p>}</div><div className="magazine-article-actions"><button type="button" onClick={() => askMagazineArticle(selectedMagazineArticle)}>爭點解析</button>{selectedMagazineArticle.sourceUrl ? <a href={selectedMagazineArticle.sourceUrl} target="_blank" rel="noreferrer">查看這篇試讀 PDF ↗</a> : null}</div></div> : <p className="column-empty">本期文章正在整理中。</p>}<a href={homeFeed.magazine.sourceUrl} target="_blank" rel="noreferrer">查看本期法學教室來源 →</a></> : <p className="column-empty">後台匯入並發布法學教室試讀內容後，最新專區會出現在這裡。</p>}</article>
        <article className={`home-editorial-card rail-editorial-card rail-music-card mobile-rail-panel ${mobileRailTool === "music" ? "mobile-active" : ""}`}><div className="column-kicker">FOCUS MUSIC</div><div className="home-editorial-head"><div><h2>讀書音樂</h2><span>{musicPlaying ? "播放中 · 再按一次停止" : "需要時再開啟 · 請點擊播放音樂"}</span></div><button type="button" className="music-play-button" onClick={toggleMusic} aria-label={musicPlaying ? "停止讀書音樂" : "點擊播放讀書音樂"}><span>{musicPlaying ? "■" : "▶"}</span><b>{musicPlaying ? "停止音樂" : "播放音樂"}</b></button></div>{youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "") ? <><iframe className={`music-iframe ${musicActivated ? "is-active" : ""}`} title="司律備考讀書音樂" src={youtubeEmbedUrl(homeFeed?.focusMusicUrl ?? "")} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen loading="eager" /><a className="music-open-link" href={youtubeWatchUrl(homeFeed?.focusMusicUrl ?? "")} target="_blank" rel="noreferrer">無法播放時，在 YouTube 開啟 ↗</a></> : <p className="column-empty">管理後台設定讀書音樂後，會在這裡提供播放。</p>}</article>
      </aside>
      </div>

      {!practiceQuestion && <div className={`composer-wrap rail-${railSide} ${railCollapsed ? "rail-collapsed" : ""}`}>
        <button
          type="button"
          className={`mobile-rail-toggle rail-${railSide}`}
          onClick={() => setMobileRailOpen(true)}
          aria-expanded={mobileRailOpen}
          aria-controls="command-rail"
        >
          <span aria-hidden="true">工具</span>
          <b>學習工具</b>
        </button>
        <section className={`model-mode-switch ${settingsCollapsed ? "is-collapsed" : ""}`} aria-label="AI 學習設定">
          <div className="model-mode-heading"><strong>AI 學習設定</strong><span className="model-mode-summary">{teachingLevelLabels[pendingTeachingLevel ?? "general"]} · {modelMode === "compare-luna-glm52" ? "Luna＋GLM-5.2" : modelMode.startsWith("compare-") ? modelMode.slice("compare-".length).split("-").map((item) => item === "luna" ? "Luna" : item === "sonnet" ? "Sonnet" : "DeepSeek").join("＋") : modelMode === "luna" ? "Luna" : modelMode === "sonnet" ? "Claude Sonnet" : modelMode === "glm" ? "GLM-4.7-Flash（免費測試）" : modelMode === "glm52" ? "GLM-5.2（付費測試）" : "DeepSeek V4-Pro"}{settingsPinned ? " · 已固定" : ""}</span><button type="button" className="follow-up-compact-button" onClick={() => pendingTeachingLevel && void runTeachingLevel(pendingTeachingLevel)} disabled={!pendingTeachingLevel || thinking || generatingStudentReply || evaluatingTeaching} aria-label="針對上一則 AI 回覆繼續追問">{evaluatingLevel ? "產生中…" : "繼續追問"}</button><button type="button" className="model-settings-toggle" onClick={() => setSettingsCollapsed((current) => { const next = !current; window.localStorage.setItem("silu-ai-settings-collapsed", String(next)); return next; })} aria-expanded={!settingsCollapsed}>{settingsCollapsed ? "展開設定" : "收合設定"}</button><button type="button" className="new-topic-button" onClick={() => void startNewTopic()} disabled={thinking || generatingStudentReply || evaluatingTeaching}>另開主題</button></div>
          {!settingsCollapsed && <>
          <div className="model-mode-fields">
            <label><span>學生</span><select value={pendingTeachingLevel ?? "general"} onChange={(event) => selectTeachingLevel(event.target.value)} disabled={settingsPinned || thinking || generatingStudentReply || evaluatingTeaching}>
              <option value="general">{teachingLevelLabels.general}</option><option value="beginner">{teachingLevelLabels.beginner}</option><option value="intermediate">{teachingLevelLabels.intermediate}</option><option value="advanced">{teachingLevelLabels.advanced}</option><option value="super">{teachingLevelLabels.super}</option>
            </select></label>
            <label><span>回答</span><select value={modelMode.startsWith("compare-") ? modelMode.split("-")[1] : modelMode} onChange={(event) => setModelMode(event.target.value as ChatModelMode)} disabled={settingsPinned || thinking || generatingStudentReply || evaluatingTeaching}>
              <option value="luna">Luna</option><option value="glm">GLM-4.7-Flash｜免費測試</option><option value="glm52">GLM-5.2｜付費測試（上限 US$2）</option><option value="sonnet">Claude Sonnet</option><option value="deepseek">DeepSeek V4-Pro</option>
            </select></label>
            <label><span>比較</span><select value={modelMode.startsWith("compare-") ? modelMode.slice("compare-".length) : "none"} onChange={(event) => { const value = event.target.value; if (value === "none") { setModelMode((current) => current.startsWith("compare-") ? current.split("-")[1] as ChatModelMode : current); } else { setModelMode(`compare-${value}` as ChatModelMode); } }} disabled={settingsPinned || thinking || generatingStudentReply || evaluatingTeaching}>
              <option value="none">不比較</option><option value="luna-glm52">Luna＋GLM-5.2</option><option value="luna-sonnet">Luna＋Sonnet</option><option value="luna-deepseek">Luna＋DeepSeek</option><option value="sonnet-deepseek">Sonnet＋DeepSeek</option><option value="luna-sonnet-deepseek">Luna＋Sonnet＋DeepSeek</option>
            </select></label>
          </div>
          <div className={`model-settings-pin-row ${settingsPinned ? "is-pinned" : ""}`}>
            <label className="model-settings-pin"><input type="checkbox" checked={settingsPinned} onChange={(event) => toggleSettingsPinned(event.target.checked)} disabled={thinking || generatingStudentReply || evaluatingTeaching} /><span>固定此角色與模型</span></label>
            <small>{settingsPinned ? "已固定；取消勾選後即可重新選擇。" : "勾選後會記住目前學生角色、回答模型與比較方式。"}</small>
          </div>
          </>}
        </section>
        {imageDraft && !editingImage && <div className="image-ready"><button className="image-ready-preview" onClick={() => setEditingImage(true)} aria-label="再次編輯圖片"><img src={imageDraft.url} alt="待送出的題目圖片" /></button><span>{imageDraft.name}<small>已準備，點圖片可再調整</small></span><button onClick={() => setImageDraft(null)} aria-label="移除圖片">×</button></div>}
        <form className="composer" onSubmit={submit} onPaste={(event) => { const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile(); if (image) { event.preventDefault(); chooseQuestionImage(new File([image], `貼上的題目-${Date.now()}.png`, { type: image.type })); } }}>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { chooseQuestionImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <button className="attach-image" type="button" aria-label="上傳或貼上圖片問問題" title="上傳圖片，也可直接按 Ctrl+V 貼上" onClick={() => imageInputRef.current?.click()}>＋</button>
          <textarea
            ref={composerInputRef}
            aria-label="輸入你想學習的內容"
            placeholder="告訴我你想學什麼，或直接貼上一道題目……"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={1}
          />
          <button className="send-button" type="submit" aria-label="送出" disabled={(!input.trim() && !imageDraft) || thinking}>↑</button>
        </form>
        <p>教材優先檢索 · 找不到時由 AI 補充並清楚標示</p>
      </div>}

      {imageDraft && editingImage && <div className="image-editor-backdrop" role="dialog" aria-modal="true" aria-label="編輯題目圖片"><section className="image-editor"><div className="image-editor-head"><div><strong>調整題目圖片</strong><span>拖曳六個控制點，保留要詢問的範圍</span></div><button onClick={() => setImageDraft(null)} aria-label="關閉">×</button></div><div className={`crop-stage ${imageDraft.enhance ? "enhanced" : ""}`} ref={editorRef}><img src={imageDraft.url} alt="圖片裁切預覽" style={{ transform: `rotate(${imageDraft.rotation}deg)` }} />{imageDraft.points.map((point, index) => <button key={index} className="crop-handle" style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`裁切控制點 ${index + 1}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveCropPoint(index, event.clientX, event.clientY); }} />)}</div><div className="image-tools"><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation - 90 } : current)}>↶ 左轉</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation + 90 } : current)}>↷ 右轉</button><button className={imageDraft.enhance ? "active" : ""} onClick={() => setImageDraft((current) => current ? { ...current, enhance: !current.enhance } : current)}>✦ 加強圖片</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: 0, enhance: false, points: [{ x: 4, y: 4 }, { x: 50, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 50, y: 96 }, { x: 4, y: 96 }] } : current)}>重設</button></div><div className="image-editor-actions"><button className="secondary" onClick={() => setImageDraft(null)}>取消</button><button onClick={() => setEditingImage(false)}>使用這張圖片</button></div><p>送出時自動縮至最長邊 1600px，並壓縮為 JPEG。</p></section></div>}
    </main>
  );
}
