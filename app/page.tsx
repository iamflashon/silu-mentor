"use client";

import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ListeningPlayer, ListeningFeed } from "./listening-player";
import { taipeiDate, taipeiGreeting } from "../lib/taipei-time";
import { formatTwd } from "../lib/currency";
import { coreExamPoints, type CoreExamPoint } from "../lib/core-exam-points";
import { useSimulationToolsEnabled } from "../lib/use-simulation-tools";

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
type TeachingEvidence = { status: "verified" | "applied_inference" | "full_text_search" | "unavailable"; retrieval: string; resourceTitle: string; segmentTitle: string; lessonLabel: string; pageStart: number | null; pageEnd: number | null; fileName: string; excerpt: string; message: string; matchedTerms?: string[]; basis?: "teacher_solution" | "chapter" };
type ChallengeThread = { targetLabel: string; targetExcerpt: string; challengeText: string; challengeUsage: ReplyUsage; replyText: string; replyUsage: ReplyUsage; version: number; applied: boolean };
type PracticeHistoryState = { questionId: number; selectedAnswer: string | null; correct: boolean | null; correctAnswer: string | null; completed: boolean; readyToComplete: boolean; discussion: boolean };
type Message = { role: "mentor" | "student"; text: string; source?: string | null; sources?: string[]; citationStatus?: string; teachingEvidence?: TeachingEvidence | null; model?: string; usage?: ReplyUsage; comparison?: ModelComparison; challengeThread?: ChallengeThread; practiceQuestion?: PracticeQuestion | null; practiceState?: PracticeHistoryState | null };

function examPointSubject(subject: string) {
  const normalized = subject.replace(/\s/g, "");
  if (/刑事訴訟|刑訴/.test(normalized)) return "刑事訴訟法";
  if (/民事訴訟|民訴/.test(normalized)) return "民事訴訟法";
  if (/刑法/.test(normalized)) return "刑法";
  if (/民法/.test(normalized)) return "民法";
  if (/憲法/.test(normalized)) return "憲法";
  if (/行政/.test(normalized)) return "行政法";
  if (/商|公司|證券|保險|票據/.test(normalized)) return "商事法";
  return "";
}
type FollowUpSelection = { key: string; label: string; model: string; text: string; prompt: string; excerpt?: string };
type AnswerAction = "plain" | "detailed" | "follow-up";
type ReplyUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; webSearchCalls?: number; modelTokenCostUsd?: number; fileSearchCostUsd?: number; webSearchCostUsd?: number; estimatedCostUsd: number; durationMs: number };
type ChatModelMode = "auto" | "luna" | "sol" | "sonnet" | "deepseek" | "glm" | "glm52" | "compare-luna-sonnet" | "compare-luna-glm52" | "compare-luna-deepseek" | "compare-sonnet-deepseek" | "compare-luna-sonnet-deepseek";
const aiSettingsStorageKey = "silu-ai-settings-pinned";
const conversationContinuationThreshold = 40;
const chatModelModes: ChatModelMode[] = ["auto", "luna", "sol", "sonnet", "deepseek", "glm", "glm52", "compare-luna-sonnet", "compare-luna-glm52", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"];
function isTeachingLevel(value: unknown): value is TeachingLevel { return value === "general" || value === "beginner" || value === "intermediate" || value === "advanced" || value === "super"; }
function isChatModelMode(value: unknown): value is ChatModelMode { return typeof value === "string" && chatModelModes.includes(value as ChatModelMode); }
type TodayTask = { id: number; taskDate: string; subject: string; title: string; durationMinutes: number; details: string; status: string };
type DashboardData = { targetLabel: string; monthsRemaining: number; officialDatePending: boolean; todayProgress: { completed: number; total: number; delayed?: number; records?: number; correct?: number; answered?: number }; record: { completedTasks: number; completedMinutes: number; totalTasks: number }; priorities: Array<{ topic: string; count: number; reason: string }>; memo: string; encouragement: string };
type TodayRecord = { subject: string; title: string; activityType: string; actualMinutes: number; nextStep: string };
type YesterdayContext = { date: string; sessionId: number | null; messageCount: number; lastStudent: string; lastMentor: string; completedTasks: number; totalTasks: number; incompleteTasks: Array<{ id: number; subject: string; title: string; durationMinutes: number; details: string }>; records: Array<{ subject: string; title: string; activityType: string; actualMinutes: number; correct: boolean | null; weakness: string; nextStep: string }> };
type CropPoint = { x: number; y: number };
type ImageDraft = { url: string; name: string; points: CropPoint[]; rotation: number; enhance: boolean };
type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type PracticeQuestion = { id: number; examType: "mcq" | "essay"; year: string; examName?: string; subject: string; questionNumber: string; stem: string; options: Record<string, string> | null };
type MagazineArticle = { id: number; title: string; summary: string; issue: string; sourceUrl: string; reviewStatus: string; sequence: number };
type HomeFeed = { book: { id: number; title: string; creator: string; hasCover?: number } | null; course: { id: number; title: string; creator: string; sourceUrl: string } | null; magazine: { id: number; title: string; sourceUrl: string; description?: string; articles?: MagazineArticle[] } | null; listening: ListeningFeed | null; focusMusicUrl?: string; recommended: Array<{ id: number; resourceId: number; title: string; summary: string; startSeconds: number; importance: number }>; ticker: Array<{ id: string; text: string; url: string; enabled: boolean }>; examCountdowns: Array<{ id: string; label: string; date: string; enabled: boolean }>; learningCenterEnabled?: boolean };
type LegalLesson = { documentId: number; title: string; articleNo: string; hierarchy: string; content: string };
type DictionaryResult = { term: string; content: string; sourceUrl: string; sourceLabel: string; sourceType?: "judicial" | "legispedia"; sourceNote?: string };
type PracticeCoachMessage = { role: "mentor" | "student"; text: string };
type MobileRailTool = "dictionary" | "listening" | "magazine" | "music";
type CurrentMember = { displayName: string; email: string; role: "teacher" | "student"; canAdmin: boolean; status: string; className?: string };
type AiMeter = { active:boolean; remaining:number; quotaTotal:number; coachRoundsUsed:number; coachWebSearchUsed:number; coachRoundsTarget:number; expiresAt:string|null };

const trustPrincipleStudentTest = "我理解信賴原則是，駕駛人可以相信行人會遵守交通規則。可是如果行人只是站在路邊等紅綠燈，駕駛人應該可以信賴他不會突然衝出來；但如果行人已經有明顯要違規的樣子，例如一直往車道靠近，駕駛人就不能再主張信賴原則。那本題中，要怎麼判斷這個行人的動作已經達到「顯然即將違規」的程度？如果我主張駕駛人仍可相信行人不會衝出來，這樣的論證有機會成立嗎？";
function sourceNameFromLink(label: string, url = "") {
  const value = `${label} ${url}`.toLowerCase();
  if (value.includes("law.moj.gov.tw")) return "全國法規資料庫";
  if (value.includes("judicial.gov.tw")) return "司法院";
  if (value.includes("moex.gov.tw")) return "考選部";
  const cleanLabel = label.trim();
  return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+(?:\/\S*)?$/i.test(cleanLabel) ? "外網查證來源" : cleanLabel;
}
function hideExternalUrls(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (_match, label: string, url: string) => sourceNameFromLink(label, url))
    .replace(/https?:\/\/[^\s)\]}>]+/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}
function cleanMessageText(text: string) { return hideExternalUrls(text).replace(/(?:\r?\n|\s)*(?:<!--\s*)?SILU_(?:PRACTICE_STATE|PRACTICE):[A-Za-z0-9_-]+(?:\s*-->)?/gi, "").replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1"); }
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
  if (status === "full_text_search") return "找到相關教材，但不足以核對本次內容";
  return "本次未取得可核對教材引用";
}
function citationStatusLabel(status?: string) {
  if (status === "verified") return "引用狀態：原文直接支持";
  if (status === "applied_inference") return "引用狀態：教材判準＋AI 涵攝";
  if (status === "full_text_search") return "";
  if (status === "web_search") return "外網查證：已列出本次查證來源名稱";
  return "引用狀態：未取得可核對教材";
}
function sourceDisplayName(source: string) {
  return source
    .replace(/｜https?:\/\/\S+$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\.(?:pdf|jsonl|md|txt|docx|zip)$/i, "")
    .trim();
}
function visibleSourceNames(sources?: string[]) {
  return [...new Set((sources ?? []).map(sourceDisplayName).filter(Boolean))];
}
function TeachingEvidenceDetails({ evidence }: { evidence?: TeachingEvidence | null }) {
  if (!evidence) return null;
  const pages = evidence.pageStart ? `第 ${evidence.pageStart}${evidence.pageEnd && evidence.pageEnd !== evidence.pageStart ? `–${evidence.pageEnd}` : ""} 頁` : "頁碼尚未核對";
  const isTeacherSolution = evidence.basis === "teacher_solution";
  const label = isTeacherSolution ? "🟢 已鎖定本題老師解析／擬答" : evidence.status === "verified" ? "🟢 教材原文直接支持本次教學內容" : evidence.status === "applied_inference" ? "🔵 教材提供判準，AI 依原文涵攝" : evidence.status === "full_text_search" ? (evidence.retrieval === "full_text_search" ? "🟡 僅命中全文索引，尚不足以核對本次內容" : "🟡 找到相關教材，但不足以核對本次內容") : "⚪ 未取得教材原文";
  return <details className={`teaching-evidence ${evidence.status}`}><summary>{label}<span>{isTeacherSolution ? "查看老師完整原文" : "展開驗證證據"}</span></summary><div><dl><div><dt>教材</dt><dd>{evidence.resourceTitle || "未設定教材名稱"}</dd></div><div><dt>實際位置</dt><dd>{[evidence.segmentTitle, evidence.lessonLabel, pages].filter(Boolean).join("｜")}</dd></div><div><dt>資料身分</dt><dd>{isTeacherSolution ? "同一題的老師爭點解析／擬答" : evidence.retrieval === "chapter_segment" ? "章節內文比對" : evidence.retrieval === "stored_analysis" ? "教材解析結果比對" : evidence.retrieval === "full_text_search" ? "全文索引搜尋" : "未使用教材"}</dd></div><div><dt>核對狀態</dt><dd>{evidence.message}</dd></div></dl>{!isTeacherSolution && evidence.matchedTerms?.length ? <p className="evidence-keywords"><b>命中關鍵：</b>{evidence.matchedTerms.join("、")}</p> : null}{evidence.excerpt ? <><b className="evidence-section-label">{isTeacherSolution ? "老師解析／擬答完整原文" : "教材原文"}</b><blockquote>{evidence.excerpt}</blockquote><small>{isTeacherSolution ? "上方精簡整理以此原文為準；AI 額外補充會另標示為「AI 延伸檢查」。" : "章節頁碼依教材檔案頁序標示；原文註腳中的其他頁碼屬引用書目頁碼。"}</small></> : null}{evidence.status === "applied_inference" ? <p className="evidence-application"><b>AI 涵攝：</b>原文負責提供抽象判準；本次回答中的具體罪名或事實判斷由 AI 依該判準完成。</p> : null}{!isTeacherSolution ? <small>綠色＝教材直接支持回答或依原文出題；藍色＝教材提供判準、AI 正常涵攝；黃色＝只有相關內容，仍不足以支持回答。</small> : null}</div></details>;
}
function answerParagraphs(text: string) {
  const clean = cleanMessageText(text).trim();
  return clean.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}
function modelLabel(model: string) {
  return /claude/i.test(model) ? "Claude Sonnet" : /deepseek/i.test(model) ? "DeepSeek V4-Pro" : /glm-5\.2/i.test(model) ? "GLM-5.2（付費測試）" : /glm/i.test(model) ? "GLM-4.7-Flash（免費測試）" : /terra/i.test(model) ? "Terra 質疑者" : /sol/i.test(model) ? "Sol 學霸" : "Luna 助教";
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
function PracticeQuestionBubble({ question, answer, onAnswer, onEssayStart }: { question: PracticeQuestion; answer: { selected: string } | null; onAnswer: (key: string) => void; onEssayStart: () => void }) {
  return <section className="practice-inline-question" aria-label="對話中的真題">
    <div className="practice-meta"><span>{question.examType === "mcq" ? "一試選擇題" : "二試申論題"}</span><strong>{question.year}年｜{question.examName || "類科待辨識"}｜{question.subject}｜第 {question.questionNumber} 題</strong></div>
    <p className="practice-stem">{question.stem}</p>
    {question.examType === "mcq" && question.options ? <div className="option-grid single-column-options">{["A", "B", "C", "D"].filter((key) => question.options?.[key]).map((key) => <button className={answer?.selected === key ? "selected" : ""} disabled={Boolean(answer)} onClick={() => onAnswer(key)} key={key}><b>{key}</b><span>{question.options?.[key]}</span></button>)}</div> : <button className="essay-start" onClick={onEssayStart}>開始學審題</button>}
  </section>;
}
function ModelComparisonCard({ comparison, messageIndex, pairedPrompt, selectedKeys, onRate, onToggleFollowUp, onAnswerAction, thinking, showCosts }: { comparison: ModelComparison; messageIndex: number; pairedPrompt: string; selectedKeys: string[]; onRate: (responseId: number, feedbackType: "preferred" | "rated", score: number) => Promise<void>; onToggleFollowUp: (selection: FollowUpSelection) => void; onAnswerAction: (action: AnswerAction, selection: { label: string; model: string; text: string; prompt: string; excerpts: string[] }) => void; thinking?: boolean; showCosts: boolean }) {
  const [scores, setScores] = useState<Record<number, number>>({});
  const [saved, setSaved] = useState<number | null>(null);
  return <section className="model-comparison-card" aria-label="AI 模型測試比較">
    <header><div><b>AI 模型測試比較</b><span>{comparisonSourceLabel(comparison.sourceStatus)}</span></div><small>每個模型使用同一個問題；回覆、Token、耗時與估算成本都會保存。</small></header>
    <div className="model-comparison-grid">
      {comparison.responses.map((response) => <article className={`model-comparison-response ${selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`) ? "follow-up-selected" : ""}`} key={response.id}>
        <div className="model-comparison-response-head"><strong>{response.label}</strong><small>{response.model}</small></div>
        {response.error ? <p className="model-comparison-error">{response.error}</p> : <MentorAnswerText text={response.text} label={response.label} model={response.model} prompt={pairedPrompt} onAnswerAction={onAnswerAction} disabled={thinking} />}
        {response.stopReason === "max_tokens" && <small className="model-comparison-truncated">⚠ Claude 回答達到輸出上限，這次內容可能不完整</small>}
        {visibleSourceNames(response.sources).length > 0 && <small className="model-comparison-sources">查證來源：{visibleSourceNames(response.sources).join("、")}</small>}
        {showCosts && <div className="model-comparison-meta"><span>{response.usage.inputTokens + response.usage.outputTokens} tokens · {response.usage.durationMs.toLocaleString()} ms</span><span>US$ {response.usage.estimatedCostUsd.toFixed(5)} · NT$ {(response.usage.estimatedCostUsd * 32.5).toFixed(3)}</span></div>}
        {!response.error && <label className={`follow-up-check ${selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`) ? "follow-up-selected" : ""}`}><input type="checkbox" checked={selectedKeys.includes(`teacher:${messageIndex}:${response.id}:${response.label}`)} onChange={() => onToggleFollowUp({ key: `teacher:${messageIndex}:${response.id}:${response.label}`, label: response.label, model: response.model, text: response.text, prompt: pairedPrompt })} /><span>回覆此訊息</span></label>}
        {!response.error && <div className="model-comparison-actions"><label>測試評分<select value={scores[response.id] ?? 0} onChange={(event) => setScores((current) => ({ ...current, [response.id]: Number(event.target.value) }))}><option value={0}>請評分</option>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} 分</option>)}</select></label><button type="button" disabled={!scores[response.id] || saved === response.id} onClick={async () => { await onRate(response.id, "rated", scores[response.id]); setSaved(response.id); }}>送出評分</button><button type="button" className="comparison-preferred" onClick={async () => { await onRate(response.id, "preferred", 5); setSaved(response.id); }}>選這個比較好</button></div>}
        {saved === response.id && <small className="model-comparison-saved">已記錄測試回饋</small>}
      </article>)}
    </div>
  </section>;
}
export function LawHome() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [solReviewingIndex, setSolReviewingIndex] = useState<number | null>(null);
  const [solReviewedIndexes, setSolReviewedIndexes] = useState<number[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [selectedTodayTaskId, setSelectedTodayTaskId] = useState<number | null>(null);
  const [yesterday, setYesterday] = useState<YesterdayContext | null>(null);
  const [dailyChoiceVisible, setDailyChoiceVisible] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [today, setToday] = useState(() => taipeiDate());
  const [homeExamPoint, setHomeExamPoint] = useState<CoreExamPoint>(() => coreExamPoints[0]);
  const [greeting, setGreeting] = useState(() => taipeiGreeting());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [railSide, setRailSide] = useState<"left" | "right">("right");
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [chatFocusMode, setChatFocusMode] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [mobileRailTool, setMobileRailTool] = useState<MobileRailTool>("dictionary");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [source, setSource] = useState<"教材" | "AI 補充" | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [lastUsage, setLastUsage] = useState<ReplyUsage | null>(null);
  const [modelMode, setModelMode] = useState<ChatModelMode>("luna");
  const [settingsPinned, setSettingsPinned] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(true);
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
  const cropFrameDragRef = useRef<{ pointerId: number; startX: number; startY: number; points: CropPoint[] } | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [editingImage, setEditingImage] = useState(false);
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestion | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState<{ selected: string; correct: boolean; correctAnswer: string } | null>(null);
  const [practiceCoachMessages, setPracticeCoachMessages] = useState<PracticeCoachMessage[]>([]);
  const [practiceCoaching, setPracticeCoaching] = useState(false);
  const [practiceCompleted, setPracticeCompleted] = useState(false);
  const [practiceReadyToComplete, setPracticeReadyToComplete] = useState(false);
  const [practiceDiscussion, setPracticeDiscussion] = useState(false);
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
  const [feedbackTarget, setFeedbackTarget] = useState<{ message: Message; index: number } | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackTypes, setFeedbackTypes] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [terraChallenging, setTerraChallenging] = useState(false);
  const [currentMember, setCurrentMember] = useState<CurrentMember | null>(null);
  const [aiMeter,setAiMeter]=useState<AiMeter|null>(null);
  const simulationToolsEnabled = useSimulationToolsEnabled();
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);
  const activeStudySubject = useMemo(() => examPointSubject(
    practiceQuestion?.subject
      || todayTasks.find((task) => task.id === selectedTodayTaskId)?.subject
      || todayTasks.find((task) => task.status !== "completed")?.subject
      || "",
  ), [practiceQuestion?.subject, selectedTodayTaskId, todayTasks]);
  const subjectExamPoints = useMemo(
    () => coreExamPoints.filter((point) => point.subject === activeStudySubject),
    [activeStudySubject],
  );
  const handoffHandled = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const loadMemberAndAiAccess = async () => {
      try {
        const accountResponse = await fetch("/api/account", { cache: "no-store" });
        const member = accountResponse.ok ? (await accountResponse.json()).member as CurrentMember : null;
        if (cancelled) return;
        setCurrentMember(member);
        if (!member) {
          setAiMeter(null);
          return;
        }

        // Cloudflare Access may refresh its authorization cookie while the page
        // is starting. Read the member first, then retry the entitlement request
        // briefly so a valid AI plan is not hidden by that transient refresh.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch("/api/ai-access", { cache: "no-store" });
          if (response.ok) {
            const aiAccess = (await response.json()).aiAccess as AiMeter;
            if (!cancelled) setAiMeter(aiAccess);
            return;
          }
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
        if (!cancelled) setAiMeter(null);
      } catch {
        if (!cancelled) {
          setCurrentMember(null);
          setAiMeter(null);
        }
      }
    };
    void loadMemberAndAiAccess();
    return () => { cancelled = true; };
  }, []);
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
    if (!chatFocusMode) return;
    const exitFocusMode = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatFocusMode(false);
    };
    window.addEventListener("keydown", exitFocusMode);
    return () => window.removeEventListener("keydown", exitFocusMode);
  }, [chatFocusMode]);

  useEffect(() => {
    if (!subjectExamPoints.length) return;
    setHomeExamPoint(subjectExamPoints[Math.floor(Math.random() * subjectExamPoints.length)] ?? subjectExamPoints[0]);
  }, [subjectExamPoints]);

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
      const taskList = data.todayTasks ?? [];
      const pendingToday = taskList.filter((task) => task.status !== "completed");
      if (restored.length) {
        setMessages(restored);
        setDailyChoiceVisible(false);
        const restoredQuestion = [...restored].reverse().find((message) => message.practiceQuestion)?.practiceQuestion ?? null;
        setPracticeQuestion(restoredQuestion);
        if (restoredQuestion) {
          const restoredState = [...restored].reverse().find((message) => message.practiceState?.questionId === restoredQuestion.id)?.practiceState ?? null;
          if (restoredState) {
            setPracticeAnswer(restoredState.selectedAnswer && restoredState.correctAnswer && typeof restoredState.correct === "boolean" ? { selected: restoredState.selectedAnswer, correct: restoredState.correct, correctAnswer: restoredState.correctAnswer } : null);
            setPracticeCompleted(restoredState.completed);
            setPracticeReadyToComplete(restoredState.readyToComplete);
            setPracticeDiscussion(restoredState.discussion);
          } else {
            const practiceMessages = restored.slice(restored.findIndex((message) => message.practiceQuestion?.id === restoredQuestion.id) + 1).filter((message) => message.source === "真題練習");
            const lastStudentText = [...practiceMessages].reverse().find((message) => message.role === "student")?.text ?? "";
            const lastMentorText = [...practiceMessages].reverse().find((message) => message.role === "mentor")?.text ?? "";
            const selectedAnswer = [...lastStudentText.matchAll(/(?:我選|改選|選擇)\s*([A-D])/gi)].at(-1)?.[1]?.toUpperCase() ?? null;
            const correctAnswer = lastMentorText.match(/正確答案(?:是|為)\s*([A-D])/i)?.[1]?.toUpperCase() ?? null;
            if (selectedAnswer && correctAnswer) setPracticeAnswer({ selected: selectedAnswer, correct: selectedAnswer === correctAnswer, correctAnswer });
            if (/正確答案(?:是|為)|判定答[對錯]|法律分析已正確|判斷已正確/.test(lastMentorText)) setPracticeReadyToComplete(true);
          }
          const questionIndex = restored.findIndex((message) => message.practiceQuestion?.id === restoredQuestion.id);
          setPracticeCoachMessages(restored.slice(questionIndex + 1).filter((message) => message.source === "真題練習").map((message) => ({ role: message.role, text: message.text })));
        }
      } else if (pendingToday.length) {
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天已經安排好 ${pendingToday.length} 項任務。我們從第一項「${pendingToday[0].title}」開始，好嗎？` }]);
        setDailyChoiceVisible(false);
      } else if (taskList.length) {
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}，${recordSummary}今天的任務都完成了。要不要趁狀態正好，先預習明天的內容？` }]);
        setDailyChoiceVisible(false);
      } else if (data.yesterday) {
        const incomplete = data.yesterday.incompleteTasks.length;
        const yesterdayProgress = data.yesterday.totalTasks
          ? `昨天完成 ${data.yesterday.completedTasks}/${data.yesterday.totalTasks} 項任務${incomplete ? `，還有 ${incomplete} 項未完成` : ""}`
          : "昨天的學習內容已保存";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}。${yesterdayProgress}。今天要怎麼開始，由你決定；我會依昨天的紀錄幫你接續。` }]);
        setDailyChoiceVisible(true);
      } else {
        const records = data.todayRecords ?? [];
        const recordSummary = records.length ? `你今天已經學過：${records.slice(0, 3).map((record) => record.title).join("、")}。` : "";
        setMessages([{ role: "mentor", text: `${data.greeting ?? taipeiGreeting()}，${recordSummary}我是司律備考的 AI 教練。${records.length ? "我們接著把今天的學習往下推進。" : "今天還沒有安排任務，我可以先根據你的目標與可用時間，幫你建立第一份學習計畫。"}` }]);
        setDailyChoiceVisible(false);
      }
    }).catch(() => {
      setMessages([{ role: "mentor", text: `${taipeiGreeting()}，我是司律備考的 AI 教練。今天想從哪一科開始？` }]);
    }).finally(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => {
    const pending = todayTasks.filter((task) => task.status !== "completed");
    if (!pending.length) {
      setSelectedTodayTaskId(null);
      return;
    }
    setSelectedTodayTaskId((current) => pending.some((task) => task.id === current) ? current : pending[0].id);
  }, [todayTasks]);

  useEffect(() => { fetch("/api/home-feed").then(async (response) => { if (response.ok) setHomeFeed(await response.json() as HomeFeed); }).catch(() => undefined); }, []);
  useEffect(() => { if (magazineArticles.length && !magazineArticles.some((article) => article.id === selectedMagazineArticleId)) setSelectedMagazineArticleId(magazineArticles[0].id); }, [magazineArticles, selectedMagazineArticleId]);
  useEffect(() => {
    if (!activeStudySubject) { setLegalLesson(null); return; }
    setLegalLesson(null);
    fetch(`/api/legal-learning?subject=${encodeURIComponent(activeStudySubject)}`).then(async (response) => { if (response.ok) setLegalLesson(((await response.json()) as { article?: LegalLesson | null }).article ?? null); }).catch(() => undefined);
  }, [activeStudySubject]);
  useEffect(() => { fetch("/api/legal-dictionary?random=1").then(async (response) => { if (response.ok) setDictionaryFeatured(await response.json() as DictionaryResult); }).catch(() => undefined); }, []);
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
    setRailCollapsed(true);
    setMobileRailOpen(false);
    setSettingsCollapsed(window.localStorage.getItem("silu-ai-settings-collapsed") !== "false");
    const pinned = window.localStorage.getItem(aiSettingsStorageKey);
    let localPreferences: { pinned: boolean; teachingLevel: TeachingLevel; modelMode: ChatModelMode; collapsed: boolean } | null = null;
    if (pinned) {
      try {
        const parsed = JSON.parse(pinned) as { pinned?: unknown; teachingLevel?: unknown; modelMode?: unknown };
        if (isTeachingLevel(parsed.teachingLevel) && isChatModelMode(parsed.modelMode)) {
          const restoredModelMode: ChatModelMode = "luna";
          setSettingsPinned(parsed.pinned !== false);
          setPendingTeachingLevel(parsed.teachingLevel === "general" ? null : parsed.teachingLevel);
          setModelMode(restoredModelMode);
          localPreferences = { pinned: parsed.pinned !== false, teachingLevel: parsed.teachingLevel, modelMode: restoredModelMode, collapsed: window.localStorage.getItem("silu-ai-settings-collapsed") !== "false" };
          if (restoredModelMode !== parsed.modelMode) {
            window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify({ ...parsed, modelMode: restoredModelMode }));
          }
        } else {
          window.localStorage.removeItem(aiSettingsStorageKey);
        }
      } catch {
        window.localStorage.removeItem(aiSettingsStorageKey);
      }
    }
    fetch("/api/chat/preferences").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { exists?: boolean; preferences?: { pinned?: unknown; teachingLevel?: unknown; modelMode?: unknown; collapsed?: unknown } };
      if (!data.exists && localPreferences) {
        void fetch("/api/chat/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(localPreferences) });
        return;
      }
      const saved = data.preferences;
      if (!saved || !isTeachingLevel(saved.teachingLevel) || !isChatModelMode(saved.modelMode)) return;
      const restoredModelMode: ChatModelMode = "luna";
      setSettingsPinned(saved.pinned === true);
      setPendingTeachingLevel(saved.teachingLevel === "general" ? null : saved.teachingLevel);
      setModelMode(restoredModelMode);
      setSettingsCollapsed(saved.collapsed !== false);
      window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify({ pinned: saved.pinned === true, teachingLevel: saved.teachingLevel, modelMode: restoredModelMode }));
      window.localStorage.setItem("silu-ai-settings-collapsed", String(saved.collapsed !== false));
    }).catch(() => undefined);
  }, []);

  function saveAiSettings(level: TeachingLevel, nextModelMode: ChatModelMode, pinned: boolean, collapsed: boolean) {
    const preferences = { pinned, teachingLevel: level, modelMode: nextModelMode, collapsed };
    window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(preferences));
    window.localStorage.setItem("silu-ai-settings-collapsed", String(collapsed));
    void fetch("/api/chat/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(preferences) }).catch(() => undefined);
  }

  function toggleSettingsPinned(next: boolean) {
    setSettingsPinned(next);
    saveAiSettings(pendingTeachingLevel ?? "general", modelMode, next, settingsCollapsed);
  }

  function persistAiSettings(level: TeachingLevel, nextModelMode: ChatModelMode = modelMode) {
    saveAiSettings(level, nextModelMode, settingsPinned, settingsCollapsed);
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
    setPracticeLoading(true); setPracticeAnswer(null); setPracticeCoachMessages([]); setPracticeQuestion(null);
    try {
      const response = await fetch(`/api/practice?type=${examType}`); const result = await response.json() as { question?: PracticeQuestion | null; message?: string };
      if (result.question) {
        setPracticeQuestion(result.question);
        setMessages((current) => [...current, { role: "mentor", text: "請直接在這裡作答；選擇後我會先問你的理由，不會先公布答案。", source: "真題庫", practiceQuestion: result.question }]);
      }
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

  function swapHomeExamPoint() {
    setHomeExamPoint((current) => {
      if (subjectExamPoints.length < 2) return current;
      const candidates = subjectExamPoints.filter((point) => point.title !== current.title);
      return candidates[Math.floor(Math.random() * candidates.length)] ?? current;
    });
  }

  function learnHomeExamPoint() {
    void send(`請帶我學習司律熱考點「${homeExamPoint.subject}｜${homeExamPoint.title}」。先用一句話說明這個考點在二試申論中的判斷分岔，再問我一個可以直接回答的小問題；不要一開始就公布完整答案。`);
  }

  async function loadRandomLegalLesson() {
    if (!activeStudySubject) return;
    const response = await fetch(`/api/legal-learning?random=1&subject=${encodeURIComponent(activeStudySubject)}`);
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

  async function askPracticeCoach(text: string, modeOverride?: "answer_reason" | "discussion" | "complete_confirm", afterCompletion?: "learning" | "next") {
    if (!practiceQuestion || practiceCoaching || !text.trim()) return;
    const studentMessage = { role: "student" as const, text: text.trim() };
    const messagesForRequest = [...practiceCoachMessages, studentMessage];
    setPracticeCoachMessages(messagesForRequest);
    setMessages((current) => [...current, { ...studentMessage, source: "真題練習" }]);
    setInput("");
    setPracticeCoaching(true);
    try {
      const dialogueMode = modeOverride ?? (practiceDiscussion ? "discussion" : "answer_reason");
      const response = await fetch("/api/practice-coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: practiceQuestion.id, selectedAnswer: practiceAnswer?.selected ?? null, messages: messagesForRequest, teachingLevel: pendingTeachingLevel ?? "general", dialogueMode,requestKey:crypto.randomUUID() }) });
      const result = await response.json() as { reply?: string; error?: string; completed?: boolean;aiAccess?:Partial<AiMeter>&{charged?:boolean} };
      const mentorMessage = { role: "mentor" as const, text: result.reply ?? result.error ?? "教練暫時無法接續，請稍後再試。" };
      setPracticeCoachMessages((current) => [...current, mentorMessage]);
      setMessages((current) => [...current, { ...mentorMessage, source: "真題練習" }]);
      if(result.aiAccess?.remaining!==null)setAiMeter(current=>current?{...current,...result.aiAccess}:current);
      const nextCompleted = dialogueMode === "complete_confirm" && Boolean(result.completed);
      const nextReadyToComplete = !nextCompleted && Boolean(result.completed);
      const nextDiscussion = !nextCompleted && (dialogueMode === "discussion" || practiceDiscussion);
      if (nextCompleted) {
        setPracticeCompleted(true);
        setPracticeReadyToComplete(false);
      } else if (nextReadyToComplete) {
        setPracticeReadyToComplete(true);
        setPracticeCompleted(false);
      } else {
        setPracticeReadyToComplete(false);
      }
      if (sessionId) await fetch("/api/chat/practice-turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, messages: [studentMessage, mentorMessage], state: { questionId: practiceQuestion.id, selectedAnswer: practiceAnswer?.selected ?? null, correct: practiceAnswer?.correct ?? null, correctAnswer: practiceAnswer?.correctAnswer ?? null, completed: nextCompleted, readyToComplete: nextReadyToComplete, discussion: nextDiscussion } satisfies PracticeHistoryState }) });
      if (afterCompletion && nextCompleted) {
        setPracticeQuestion(null);
        setPracticeAnswer(null);
        setPracticeCoachMessages([]);
        setPracticeCompleted(false);
        setPracticeReadyToComplete(false);
        setPracticeDiscussion(false);
        if (afterCompletion === "next") await startPractice("mcq");
        else await send("這一題先告一段落。請回到目前正在學習的主題，接著說明下一個相關觀念或判斷步驟；現在先不要立刻抽新題，但之後仍可安排練題。這只是暫時離開練題，不得解讀或表述成『今天不出題』，也不要延續剛才題目的個別事實。");
        return;
      }
      if (/本題引導結束|本次對話已結束/.test(mentorMessage.text)) setPracticeQuestion(null);
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
    setPracticeCompleted(false);
    setPracticeReadyToComplete(false);
    setPracticeDiscussion(false);
    const turns: PracticeCoachMessage[] = [
      { role: "student", text: `我選 ${answer}` },
      { role: "mentor", text: `好，先不公布答案。你為什麼選 ${answer}？請說出你判斷時抓到的法律原則或關鍵文字。` },
    ];
    setPracticeCoachMessages(turns);
    setMessages((current) => [...current, ...turns.map((turn) => ({ ...turn, source: "真題練習" }))]);
    if (sessionId) void fetch("/api/chat/practice-turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, messages: turns, state: { questionId: practiceQuestion.id, selectedAnswer: answer, correct: result.correct, correctAnswer: result.correctAnswer, completed: false, readyToComplete: false, discussion: false } satisfies PracticeHistoryState }) });
  }

  function chooseQuestionImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { setImageDraft({ url: String(reader.result), name: file.name, rotation: 0, enhance: false, points: [{ x: 6, y: 6 }, { x: 94, y: 6 }, { x: 94, y: 94 }, { x: 6, y: 94 }] }); setEditingImage(true); };
    reader.readAsDataURL(file);
  }

  function cropBounds(points: CropPoint[]) {
    return { left: Math.min(...points.map((point) => point.x)), right: Math.max(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), bottom: Math.max(...points.map((point) => point.y)) };
  }

  function moveCropHandle(handle: CropHandle, clientX: number, clientY: number) {
    const rect = editorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100));
    setImageDraft((current) => {
      if (!current) return current;
      const bounds = cropBounds(current.points); const minimum = 8;
      let { left, right, top, bottom } = bounds;
      if (handle.includes("w")) left = Math.min(x, right - minimum);
      if (handle.includes("e")) right = Math.max(x, left + minimum);
      if (handle.includes("n")) top = Math.min(y, bottom - minimum);
      if (handle.includes("s")) bottom = Math.max(y, top + minimum);
      return { ...current, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] };
    });
  }

  function moveCropFrame(clientX: number, clientY: number) {
    const rect = editorRef.current?.getBoundingClientRect(); const drag = cropFrameDragRef.current;
    if (!rect || !drag) return;
    const dx = (clientX - drag.startX) / rect.width * 100; const dy = (clientY - drag.startY) / rect.height * 100;
    const bounds = cropBounds(drag.points);
    const safeDx = Math.max(-bounds.left, Math.min(100 - bounds.right, dx));
    const safeDy = Math.max(-bounds.top, Math.min(100 - bounds.bottom, dy));
    setImageDraft((current) => current ? { ...current, points: drag.points.map((point) => ({ x: point.x + safeDx, y: point.y + safeDy })) } : current);
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

  async function send(text: string, overrideMode?: ChatModelMode, options?: { hideStudentMessage?: boolean; professionalVerification?: boolean }) {
    composerInputRef.current?.blur();
    const value = text.trim();
    if ((!value && !imageDraft) || thinking) return;
    const sentTeachingLevel = pendingTeachingLevel;
    const question = value || "請先辨識這張圖片中的題目，帶我一步一步審題。";
    const attachedImage = imageDraft ? await prepareQuestionImage(imageDraft) : undefined;
    let activeSessionId = sessionId;
    let activeMessages = messages;
    if (!options?.hideStudentMessage && sessionId && messages.length >= conversationContinuationThreshold) {
      try {
        const continuationResponse = await fetch("/api/chat/new-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, continueConversation: true }),
        });
        const continuation = await continuationResponse.json() as { sessionId?: number; greeting?: string; carryoverSummary?: string; error?: string };
        if (!continuationResponse.ok || !continuation.sessionId) throw new Error(continuation.error ?? "目前無法建立對話續篇");
        activeSessionId = continuation.sessionId;
        const continuationMessage: Message = { role: "mentor", text: continuation.greeting ?? "已保存原對話，從這裡繼續。" };
        activeMessages = [continuationMessage];
        setSessionId(continuation.sessionId);
        setMessages(activeMessages);
      } catch (error) {
        setMessages((current) => [...current, { role: "mentor", text: error instanceof Error ? error.message : "目前無法建立對話續篇，原紀錄仍然保留。" }]);
        return;
      }
    }
    const requestMessages: Message[] = [...activeMessages, { role: "student", text: imageDraft ? `📷 ${question}` : question }];
    const nextMessages = options?.hideStudentMessage ? messages : requestMessages;
    setMessages(nextMessages);
    if (!sentTeachingLevel) setTeachingRounds([]);
    if (!sentTeachingLevel) setTeachingUsage([]);
    setSelectedFollowUps([]);
    if (!options?.hideStudentMessage) {
      setInput("");
      setDailyChoiceVisible(false);
      setImageDraft(null);
      setEditingImage(false);
      setSettingsCollapsed(true);
      window.localStorage.setItem("silu-ai-settings-collapsed", "true");
    }
    setThinking(true);
    try {
      const requestKey=crypto.randomUUID();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: requestMessages.slice(-12), sessionId: activeSessionId, imageDataUrl: attachedImage, modelMode: overrideMode ?? modelMode, teachingLevel: sentTeachingLevel, persistStudentMessage: !options?.hideStudentMessage, professionalVerification: options?.professionalVerification === true, requestKey }),
      });
      const result = await response.json() as { reply?: string; source?: "教材" | "AI 補充"; sources?: string[]; citationStatus?: string; teachingEvidence?: TeachingEvidence | null; usage?: ReplyUsage; sessionId?: number; error?: string; comparison?: ModelComparison | null; practiceQuestion?: PracticeQuestion | null; aiAccess?:AiMeter&{charged?:boolean} };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "對話暫時無法使用");
      setMessages((current) => [...current, { role: "mentor", text: result.reply!, model: result.usage?.model, usage: result.usage, sources: result.sources ?? [], citationStatus: result.citationStatus, teachingEvidence: result.teachingEvidence, comparison: result.comparison ?? undefined, practiceQuestion: result.practiceQuestion ?? undefined, source: result.practiceQuestion ? "真題庫" : result.source }]);
      if (result.practiceQuestion) {
        setPracticeQuestion(result.practiceQuestion);
        setPracticeAnswer(null);
        setPracticeCoachMessages([]);
        setSource(null);
      } else {
        setSource(result.source ?? "AI 補充");
      }
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
      if(result.aiAccess?.remaining!==null)setAiMeter(current=>current?{...current,...result.aiAccess!,active:true}:current);
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
    if (practiceQuestion && practiceCoachMessages.length > 0) void askPracticeCoach(input);
    else void send(input);
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
    setPracticeQuestion(null);
    setPracticeLoading(false);
    setPracticeAnswer(null);
    setPracticeCoachMessages([]);
    setPracticeCoaching(false);
    setPracticeCompleted(false);
    setPracticeReadyToComplete(false);
    setPracticeDiscussion(false);
    setTeachingRounds([]);
      setTeachingUsage([]);
      setSelectedFollowUps([]);
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
          subject: practiceQuestion?.subject,
          question: practiceQuestion
            ? `${practiceQuestion.stem}\n${practiceQuestion.options ? Object.entries(practiceQuestion.options).map(([key, value]) => `${key}. ${value}`).join("\n") : ""}`.trim()
            : undefined,
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
      persistAiSettings("general");
      return;
    }
    setPendingTeachingLevel(level);
    persistAiSettings(level);
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
    const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: "law", sourceType: "conversation", sourceId: sessionId ? `${sessionId}-${index}` : String(index), title: cleanMessageText(message.text).slice(0, 32), content: cleanMessageText(message.text), subject: todayTasks.find((task) => task.status !== "completed")?.subject ?? "綜合", tags: "AI對話", sourceLabel: visibleSourceNames(message.sources).join("、") }) });
    if (response.ok) { setSavedMessage(index); window.setTimeout(() => setSavedMessage(null), 1600); }
  }

  async function sendFeedback(message: Message, index: number, feedbackType: "helpful" | "incorrect" | "not_learning" | "unclear", askSol = false) {
    if (!askSol && !feedbackTarget && (feedbackType === "incorrect" || feedbackType === "unclear")) {
      setFeedbackTarget({ message, index });
      setFeedbackTypes(feedbackType === "unclear" ? ["hard_to_understand"] : []);
      return;
    }
    setFeedbackSaving(true);
    const originalPrompt = pairedStudentPrompt(messages, index);
    const response = await fetch("/api/chat/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, messageIndex: index, feedbackType, messageText: cleanMessageText(message.text), rating: feedbackRating, errorTypes: feedbackTypes, studentNote: feedbackNote, model: message.model ?? "gpt-5.6-luna", originalPrompt, solRequested: askSol }) });
    setFeedbackSaving(false);
    if (!response.ok) return;
    setFeedbackMessage(index); setFeedbackTarget(null); setFeedbackRating(0); setFeedbackTypes([]); setFeedbackNote("");
    window.setTimeout(() => setFeedbackMessage(null), 1600);
    if (askSol) void send(`你是 Sol 學霸，請獨立覆核 Luna 助教的回答。以原始題目為最高依據，逐項指出應保留、修正、刪除及補充之處；若題示事實不足，採條件式結論，不得自行補充事實。\n\n【學生原問題】\n${originalPrompt}\n\n【Luna 助教回答】\n${cleanMessageText(message.text)}\n\n【學生指出的問題】\n${feedbackNote || "請全面檢查"}\n\n最後請直接給出修正後版本。`, "sol", { hideStudentMessage: true });
  }

  async function requestSolReview(message: Message, index: number) {
    if (thinking || solReviewingIndex !== null || solReviewedIndexes.includes(index)) return;
    const originalPrompt = pairedStudentPrompt(messages, index);
    setSolReviewingIndex(index);
    try {
      await send(`你是 Sol 學霸，請獨立覆核 Luna 助教的回答。若本題有老師解析／擬答，必須以老師原文校準第一層標題、行為人順序、罪名順序與結論。逐項標示應保留、修正及補充之處；不同學說只能列為補充爭議，不得悄悄取代老師採說，也不得補造題目事實。\n\n【學生原問題】\n${originalPrompt || "請依目前對話中的原始題目覆核"}\n\n【Luna 助教回答】\n${cleanMessageText(message.text)}\n\n最後請依老師原本順序直接給出修正版。`, "sol", { hideStudentMessage: true });
      setSolReviewedIndexes((current) => current.includes(index) ? current : [...current, index]);
    } finally {
      setSolReviewingIndex(null);
    }
  }

  async function challengeSelectedMessageWithTerra() {
    if (thinking || terraChallenging || selectedFollowUps.length !== 1) return;
    const target = selectedFollowUps[0];
    if (!/(?:luna|sol)/i.test(target.model)) return;
    setTerraChallenging(true);
    try {
      const response = await fetch("/api/chat/message-challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, prompt: target.prompt, targetText: target.text, targetModel: target.model }) });
      const result = await response.json() as { targetLabel?: string; targetExcerpt?: string; challenge?: { text: string; usage: ReplyUsage }; reply?: { text: string; usage: ReplyUsage }; error?: string };
      if (!response.ok || !result.challenge || !result.reply) throw new Error(result.error ?? "Terra 暫時無法完成質疑。");
      const targetIndex = Number(target.key.match(/^teacher:(\d+)$/)?.[1] ?? -1);
      setMessages((current) => current.map((message, index) => index === targetIndex ? { ...message, challengeThread: {
        targetLabel: result.targetLabel ?? target.label,
        targetExcerpt: result.targetExcerpt ?? cleanMessageText(target.text).slice(0, 260),
        challengeText: result.challenge!.text,
        challengeUsage: result.challenge!.usage,
        replyText: result.reply!.text,
        replyUsage: result.reply!.usage,
        version: (message.challengeThread?.version ?? 1) + 1,
        applied: false,
      } } : message));
      setSelectedFollowUps([]);
      setSource("AI 補充");
      setLastUsage(result.reply.usage);
    } catch (error) {
      setMessages((current) => [...current, { role: "mentor", text: error instanceof Error ? error.message : "Terra 暫時無法完成質疑。" }]);
    } finally {
      setTerraChallenging(false);
    }
  }

  function applyChallengeRevision(index: number) {
    setMessages((current) => current.map((message, messageIndex) => messageIndex === index && message.challengeThread ? {
      ...message,
      text: message.challengeThread.replyText,
      usage: message.challengeThread.replyUsage,
      challengeThread: { ...message.challengeThread, applied: true },
    } : message));
  }

  return (
    <main className={`coach-shell ${chatFocusMode ? "chat-focus-mode" : ""}`}>
      <header className="topbar">
        <div className="brand-zone"><a href="/law" className="brand" aria-label="司律備考首頁"><span className="brand-mark">律</span><span>司律備考</span></a>{nextExam ? <div className="exam-countdown" aria-label={`距離${nextExam.label}還有${nextExam.days}天`}><span>距離 {nextExam.label}</span><strong>{nextExam.days === 0 ? "就是今天" : `${nextExam.days} 天`}</strong></div> : null}</div>
        <div className="top-actions">
          <a href="/practice" className="admin-link">練真題</a>
          <a href="/essay" className="admin-link">寫申論</a>
          <a href="/issues" className="admin-link">找爭點</a>
          <a href="/summaries" className="admin-link">整摘要</a>
          <a href="/law/guide" className="admin-link">使用說明</a>
          {currentMember?.canAdmin && <a href="/admin/library" className="admin-link">管理後台</a>}
          <a href="/notes" className="top-note-link" aria-label="開啟我的筆記區"><span aria-hidden="true">✎</span><b>筆記</b></a>
          {currentMember ? <div className={`member-menu-wrap ${memberMenuOpen ? "is-open" : ""}`}>
            <button type="button" className="member-chip" title={currentMember.email} aria-haspopup="menu" aria-expanded={memberMenuOpen} onClick={() => setMemberMenuOpen((open) => !open)}><span>{currentMember.displayName.slice(0, 1)}</span><b>{currentMember.displayName}</b><small>帳號</small><i aria-hidden="true">⌄</i></button>
            {memberMenuOpen && <><button type="button" className="member-menu-backdrop" aria-label="關閉帳號選單" onClick={() => setMemberMenuOpen(false)} /><div className="member-menu" role="menu"><div><strong>{currentMember.displayName}</strong><small>{currentMember.email}</small></div><a href="/account" role="menuitem">會員設定</a><a href="/api/member/logout?return_to=%2Flaw" role="menuitem" className="member-menu-signout">登出</a></div></>}
          </div> : <a href="/member-login?return_to=%2Flaw" className="member-signin">登入我的學習平台</a>}
        </div>
      </header>
      <div className="study-ticker" aria-label="司律作戰快訊"><strong>作戰快訊</strong><div><span>{(homeFeed?.ticker?.length ? homeFeed.ticker : [{ id: "default", text: "今日任務完成後，記得留下學習接續點", url: "", enabled: true }]).map((item, index) => <span className="ticker-item" key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.text}</a> : item.text}{index < (homeFeed?.ticker?.length || 1) - 1 ? <b>◆</b> : null}</span>)}</span></div></div>
      <nav className="mobile-primary-tabs" aria-label="主要學習功能">
        <a href="/practice">練真題</a>
        <a href="/essay">寫申論</a>
        <a href="/issues">找爭點</a>
        <a href="/summaries">整摘要</a>
        <a href="/law/guide">使用說明</a>
      </nav>

      <div className="home-date-line" aria-label={`${greeting}，今天日期`}><span>今天｜{dateLabel(today)}</span>{activeStudySubject && (legalLesson ? <div className="daily-law-actions"><button type="button" className="daily-law-button" onClick={teachLegalLesson}><b>{activeStudySubject}法條</b><span>{legalLesson.title} {legalLesson.articleNo}</span></button><button type="button" className="daily-law-swap" onClick={() => void loadRandomLegalLesson()}>換法條</button></div> : <span className="daily-law-pending"><b>{activeStudySubject}法條</b><span>正在依今日考科推薦</span></span>)}<section className="practice-inline-launch" aria-label="練真題"><strong>練真題</strong><div><button type="button" onClick={() => startPractice("mcq")} disabled={practiceLoading}>一試選擇題</button></div></section></div>

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
          {activeStudySubject && subjectExamPoints.length > 0 && <div className="home-exam-point" aria-label={`${activeStudySubject}今日熱考點推薦`}>
            <span>今日熱考點</span>
            <button type="button" className="home-exam-point-title" onClick={learnHomeExamPoint}><b>{homeExamPoint.subject}</b>{homeExamPoint.title}</button>
            <button type="button" className="home-exam-point-swap" onClick={swapHomeExamPoint}>換一個</button>
          </div>}
          <div className="home-calendar-entry">
            <span>我會讀取你的計畫、進度與教材，接著上次的地方帶你學。</span>
            <a href="/calendar" aria-label="開啟我的行事曆">行事曆</a>
          </div>
          <button type="button" className="desktop-rail-toggle" onClick={toggleRailCollapsed} aria-expanded={!railCollapsed} aria-controls="command-rail">
            {railCollapsed ? "展開學習工具" : "收合側欄"}
          </button>
        </div>
        {todayTasks.length > 0 && <details className="today-plan-card">
          <summary><div><b>今日任務</b><span>{todayTasks.filter((task) => task.status === "completed").length}/{todayTasks.length} 完成 · {todayTasks.find((task) => task.id === selectedTodayTaskId)?.title ?? "今日任務已完成"}</span></div><em aria-hidden="true"><span className="today-plan-expand-label">展開任務⌄</span><span className="today-plan-collapse-label">收合任務⌃</span></em></summary>
          <div className="today-plan-head"><div><p>今日學習計畫</p><strong>{today || "今天"}</strong></div><a href="/calendar">查看行事曆 →</a></div>
          <p className="today-task-choice-hint">勾選你想先學的項目</p>
          <div className="today-task-list">{todayTasks.map((task) => {
            const completed = task.status === "completed";
            const selected = !completed && task.id === selectedTodayTaskId;
            return <button type="button" className={`today-task ${completed ? "done" : ""} ${selected ? "selected" : ""}`} aria-pressed={selected} disabled={completed} onClick={() => setSelectedTodayTaskId(task.id)} key={task.id}><span aria-hidden="true">{completed || selected ? "✓" : ""}</span><div><strong>{task.subject} · {task.title}</strong><small>{task.durationMinutes} 分鐘{task.details ? ` · ${task.details}` : ""}</small></div>{selected && <em>先學這項</em>}</button>;
          })}</div>
          {todayTasks.some((task) => task.status !== "completed") && <button className="today-task-start" disabled={!selectedTodayTaskId || thinking} onClick={() => { const task = todayTasks.find((item) => item.id === selectedTodayTaskId); if (task) void send(`請直接帶我開始今天選定的任務：${task.subject}・${task.title}。任務內容：${task.details || "依今日計畫開始教學"}`); }}>{thinking ? "教練準備中…" : "開始所選任務"}</button>}
        </details>}

        <div className="message-list" ref={messageListRef}>
          {!historyLoaded && <div className="message-row mentor"><span className="mentor-avatar">律</span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === "mentor" && <span className="mentor-avatar">律</span>}
            <div className="message-bubble">{message.comparison ? <ModelComparisonCard comparison={message.comparison} messageIndex={index} pairedPrompt={pairedStudentPrompt(messages, index)} selectedKeys={selectedFollowUpKeys} onRate={rateComparison} onToggleFollowUp={toggleFollowUpSelection} onAnswerAction={runAnswerAction} thinking={thinking} showCosts={showCosts} /> : <>{message.role === "mentor" ? <MentorAnswerText text={message.text} label={modelLabel(message.model ?? "gpt-5.6-luna")} model={message.model ?? "gpt-5.6-luna"} prompt={pairedStudentPrompt(messages, index)} onAnswerAction={runAnswerAction} disabled={thinking} showLearningActions={false} /> : <span className="message-text">{cleanMessageText(message.text)}</span>}{message.role === "mentor" && message.usage && showCosts ? <small className="message-usage"><b>{message.usage.model.replace("gpt-5.6-", "")}</b><span>輸入 {message.usage.inputTokens.toLocaleString()} · 輸出 {message.usage.outputTokens.toLocaleString()} · 合計 {(message.usage.inputTokens + message.usage.outputTokens).toLocaleString()} tokens</span><span>Token 成本 US$ {(message.usage.modelTokenCostUsd ?? message.usage.estimatedCostUsd).toFixed(5)} · 約 NT$ {formatTwd(message.usage.modelTokenCostUsd ?? message.usage.estimatedCostUsd)}</span>{message.usage.webSearchCalls ? <span>外網查證 {message.usage.webSearchCalls} 次 · 搜尋成本 US$ {(message.usage.webSearchCostUsd ?? 0).toFixed(5)} · 約 NT$ {formatTwd(message.usage.webSearchCostUsd ?? 0)}</span> : null}<span>本次合計 US$ {message.usage.estimatedCostUsd.toFixed(5)} · 約 NT$ {formatTwd(message.usage.estimatedCostUsd)} · 耗時 {message.usage.durationMs.toLocaleString()} ms</span></small> : null}{message.role === "mentor" && visibleSourceNames(message.sources).length ? <small className="message-sources">{message.citationStatus === "web_search" ? "查證來源" : "教材來源"}：{visibleSourceNames(message.sources).join("、")}{citationStatusLabel(message.citationStatus) ? ` · ${citationStatusLabel(message.citationStatus)}` : ""}</small> : message.role === "mentor" && message.citationStatus && citationStatusLabel(message.citationStatus) ? <small className="message-sources">{citationStatusLabel(message.citationStatus)}</small> : null}</>}{message.role === "mentor" && <div className="message-actions">{!message.comparison && <label className={`follow-up-check message-follow-up-check ${selectedFollowUpKeys.includes(`teacher:${index}`) ? "follow-up-selected" : ""}`}><input type="checkbox" checked={selectedFollowUpKeys.includes(`teacher:${index}`)} onChange={() => toggleFollowUpSelection({ key: `teacher:${index}`, label: modelLabel(message.model ?? "gpt-5.6-luna"), model: message.model ?? "gpt-5.6-luna", text: message.text, prompt: pairedStudentPrompt(messages, index) })} /><span>回覆此訊息</span></label>}{isLearningNote(message.text) && <button type="button" className="save-note-button" onClick={() => saveMessageNote(message, index)}>{savedMessage === index ? "已收藏 ✓" : "收藏筆記"}</button>}{/luna/i.test(message.model ?? "luna") && <button type="button" className="ask-sol-button" disabled={thinking || solReviewingIndex !== null || solReviewedIndexes.includes(index)} onClick={() => void requestSolReview(message, index)}>{solReviewingIndex === index ? "Sol 覆核中…" : solReviewedIndexes.includes(index) ? "Sol 已覆核 ✓" : "✦ 請 Sol 學霸覆核"}</button>}<details className="feedback-menu"><summary>{feedbackMessage === index ? "已送老師 ✓" : /sol/i.test(message.model ?? "") ? "回饋並請老師確認" : "回饋"}</summary><div><button type="button" onClick={() => sendFeedback(message, index, "helpful")}>有幫助</button><button type="button" onClick={() => sendFeedback(message, index, "incorrect")}>內容有誤</button><button type="button" onClick={() => sendFeedback(message, index, "unclear")}>不夠清楚</button><button type="button" onClick={() => sendFeedback(message, index, "not_learning")}>非學習內容</button></div></details></div>}</div>
              {message.role === "mentor" && index === messages.length - 1 && !practiceQuestion && source && <small className="message-answer-source">本次回答：{source === "教材" ? "依平台教材整理" : "平台教材未命中，使用 AI 一般知識補充"}</small>}
              {message.role === "mentor" && message.practiceQuestion && <PracticeQuestionBubble question={message.practiceQuestion} answer={practiceAnswer} onAnswer={(key) => void answerMcq(key)} onEssayStart={beginEssayCoach} />}
              {message.role === "mentor" && message.challengeThread && <section className="message-challenge-thread" aria-label={`Terra 對 ${message.challengeThread.targetLabel} 的局部質疑`}>
                <header><span>局部質疑串</span><b>質疑對象：{message.challengeThread.targetLabel} 原評論</b><small>第 {message.challengeThread.version - 1} 版 → 第 {message.challengeThread.version} 版</small></header>
                <blockquote><b>被質疑段落</b><p>{message.challengeThread.targetExcerpt}</p></blockquote>
                <article className="terra"><b>Terra 質疑／吐槽</b><p>{message.challengeThread.challengeText}</p>{showCosts && <small>{message.challengeThread.challengeUsage.inputTokens + message.challengeThread.challengeUsage.outputTokens} tokens · 約 NT$ {formatTwd(message.challengeThread.challengeUsage.estimatedCostUsd)}</small>}</article>
                <article className="model-reply"><b>{message.challengeThread.targetLabel} 回應並修正</b><p>{message.challengeThread.replyText}</p>{showCosts && <small>{message.challengeThread.replyUsage.inputTokens + message.challengeThread.replyUsage.outputTokens} tokens · 約 NT$ {formatTwd(message.challengeThread.replyUsage.estimatedCostUsd)}</small>}</article>
                <footer><button type="button" disabled={message.challengeThread.applied} onClick={() => applyChallengeRevision(index)}>{message.challengeThread.applied ? "已套用至原評論 ✓" : `套用至 ${message.challengeThread.targetLabel} 原評論`}</button><span>未按套用前，原評論不會被改動。</span></footer>
              </section>}
              {message.role === "mentor" && showEvidence && <TeachingEvidenceDetails evidence={message.teachingEvidence} />}
            </div>
          ))}
          {practiceQuestion && practiceReadyToComplete && !practiceCompleted && messages.at(-1)?.role === "mentor" && <section className="practice-complete-actions practice-understanding-actions" aria-label="解析後由學生決定是否完成">
            <div><b>這一題接下來怎麼走？</b><span>想繼續問本題，可直接在下方輸入；理解後再選下一步。</span></div>
            <div><button type="button" onClick={() => { setPracticeReadyToComplete(false); void askPracticeCoach("我已理解本題，請記錄完成；接著我想再練一題。", "complete_confirm", "next"); }}>再練一題</button><button type="button" className="secondary" onClick={() => { setPracticeReadyToComplete(false); void askPracticeCoach("我已理解本題，請記錄完成；接著先回到目前主題教學，不要立刻抽下一題。", "complete_confirm", "learning"); }}>回到主題教學</button></div>
          </section>}
          {practiceQuestion && practiceDiscussion && !practiceReadyToComplete && !practiceCompleted && !practiceCoaching && messages.at(-1)?.role === "mentor" && <section className="practice-complete-actions practice-discussion-actions" aria-label="本題持續討論中的選擇">
            <div><b>還在討論這一題</b><span>可以繼續輸入問題；理解後再由你親自完成。</span></div>
            <div><button type="button" onClick={() => void askPracticeCoach("我已理解本題，請記錄完成；接著我想再練一題。", "complete_confirm", "next")}>再練一題</button><button type="button" className="secondary" onClick={() => void askPracticeCoach("我已理解本題，請記錄完成；接著先回到目前主題教學，不要立刻抽下一題。", "complete_confirm", "learning")}>回到主題教學</button></div>
          </section>}
          {practiceQuestion && practiceCompleted && messages.at(-1)?.role === "mentor" && <section className="practice-complete-actions" aria-label="本題完成後的選擇">
            <div><b>本題完成</b><span>可接著練題，或暫時回到目前主題的觀念教學。</span></div>
            <div><button type="button" onClick={() => { setPracticeQuestion(null); setPracticeAnswer(null); setPracticeCoachMessages([]); setPracticeCompleted(false); setPracticeReadyToComplete(false); setPracticeDiscussion(false); void startPractice("mcq"); }}>再練一題</button><button type="button" className="secondary" onClick={() => { setPracticeQuestion(null); setPracticeAnswer(null); setPracticeCoachMessages([]); setPracticeCompleted(false); setPracticeReadyToComplete(false); setPracticeDiscussion(false); void send("這一題先告一段落。請回到目前正在學習的主題，接著說明下一個相關觀念或判斷步驟；現在先不要立刻抽新題，但之後仍可安排練題。這只是暫時離開練題，不得解讀或表述成『今天不出題』，也不要延續剛才題目的個別事實。"); }}>回到主題教學</button></div>
          </section>}
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
        </div>

        {feedbackTarget && <div className="feedback-dialog-backdrop" onMouseDown={() => !feedbackSaving && setFeedbackTarget(null)}><section className="feedback-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="feedback-dialog-close" onClick={() => setFeedbackTarget(null)} aria-label="關閉">×</button><span>協助老師一起把答案修得更好</span><h2>這則 AI 助教回答錯在哪裡？</h2><label className="feedback-stars">評分<div>{[1,2,3,4,5].map((score) => <button type="button" className={score <= feedbackRating ? "selected" : ""} onClick={() => setFeedbackRating(score)} key={score}>★</button>)}</div></label><fieldset><legend>可複選錯誤類型</legend>{[["missing_issue","漏掉重要爭點"],["wrong_law","法條或罪名錯誤"],["wrong_application","涵攝不符合題目事實"],["unclear_conclusion","結論不明確"],["conflicts_source","與教材／老師擬答不一致"],["hard_to_understand","說明太難或不夠清楚"],["other","其他錯誤"]].map(([value,label]) => <label key={value}><input type="checkbox" checked={feedbackTypes.includes(value)} onChange={() => setFeedbackTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{label}</label>)}</fieldset><label className="feedback-note">補充說明<textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} rows={4} placeholder="請告訴我們 AI 助教錯在哪裡，或貼上你認為正確的理由。" /></label><div className="feedback-dialog-actions"><button disabled={feedbackSaving} onClick={() => void sendFeedback(feedbackTarget.message, feedbackTarget.index, feedbackTypes.includes("hard_to_understand") && feedbackTypes.length === 1 ? "unclear" : "incorrect")}>只送給老師確認</button>{/luna/i.test(feedbackTarget.message.model ?? "luna") && <button className="ask-sol-button" disabled={feedbackSaving} onClick={() => void sendFeedback(feedbackTarget.message, feedbackTarget.index, "incorrect", true)}>✦ 請 Sol 學霸立即評斷</button>}</div><small>送出後進入待檢查；Sol 覆核不能取代老師的最終確認。</small></section></div>}

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

      <div className={`composer-wrap rail-${railSide} ${railCollapsed ? "rail-collapsed" : ""}`}>
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
          {aiMeter?.active&&<div className="ai-meter-row"><a className="ai-usage-meter" href="/account#ai-access" aria-label={`AI 教練進度 ${aiMeter.coachRoundsUsed}／${aiMeter.coachRoundsTarget} 輪，剩餘 ${aiMeter.remaining} 次`}><strong>AI 教練 {aiMeter.coachRoundsUsed}／{aiMeter.coachRoundsTarget} 輪</strong><span>{practiceCoaching||thinking?"AI 回覆完成後計入本輪":aiMeter.coachRoundsUsed===0?`再完成 ${aiMeter.coachRoundsTarget} 輪扣 1 次`:`再完成 ${Math.max(0,aiMeter.coachRoundsTarget-aiMeter.coachRoundsUsed)} 輪扣 1 次`} · 剩餘 {aiMeter.remaining} 次</span><em>查看方案</em></a><button className="professional-verification-button" type="button" onClick={() => setVerificationOpen(true)} disabled={thinking || practiceCoaching || !input.trim() || aiMeter.coachWebSearchUsed>=1} title={aiMeter.coachWebSearchUsed>=1?"本組專業查證已使用，下一組重新提供":input.trim()?"使用目前輸入的問題進行官方來源查證":"請先輸入要查證的問題"}>{aiMeter.coachWebSearchUsed>=1?"本組已查證":"查證最新資料"}</button></div>}
          {currentMember?.canAdmin && simulationToolsEnabled && <section className={`model-mode-switch ${settingsCollapsed ? "is-collapsed" : ""}`} aria-label="AI 學習設定">
          <div className="model-mode-heading"><strong>AI 學習設定</strong><span className="model-mode-summary">{teachingLevelLabels[pendingTeachingLevel ?? "general"]} · Luna</span><button type="button" className="follow-up-compact-button" onClick={() => void generateStudentFollowUp(pendingTeachingLevel ?? undefined)} disabled={!canGenerateStudentReply || thinking || generatingStudentReply || evaluatingTeaching} aria-label="針對上一則 AI 回覆繼續追問">{evaluatingLevel ? "產生中…" : "繼續追問"}</button><button type="button" className="model-settings-toggle" onClick={() => setSettingsCollapsed((current) => { const next = !current; saveAiSettings(pendingTeachingLevel ?? "general", "luna", settingsPinned, next); return next; })} aria-expanded={!settingsCollapsed}>{settingsCollapsed ? "展開設定" : "收合設定"}</button></div>
          {!settingsCollapsed && <>
          <div className="model-mode-fields">
            <label><span>學生</span><select value={pendingTeachingLevel ?? "general"} onChange={(event) => selectTeachingLevel(event.target.value)} disabled={settingsPinned || thinking || generatingStudentReply || evaluatingTeaching}>
              <option value="general">{teachingLevelLabels.general}</option><option value="beginner">{teachingLevelLabels.beginner}</option><option value="intermediate">{teachingLevelLabels.intermediate}</option><option value="advanced">{teachingLevelLabels.advanced}</option><option value="super">{teachingLevelLabels.super}</option>
            </select></label>
            <label><span>回答</span><select value="luna" disabled><option value="luna">Luna</option></select></label>
          </div>
          <div className={`model-settings-pin-row ${settingsPinned ? "is-pinned" : ""}`}>
            <label className="model-settings-pin"><input type="checkbox" checked={settingsPinned} onChange={(event) => toggleSettingsPinned(event.target.checked)} disabled={thinking || generatingStudentReply || evaluatingTeaching} /><span>記住學生角色</span></label>
            <small>Luna 為首頁固定模型；此設定只記住學生角色。</small>
          </div>
          </>}
        </section>}
        {imageDraft && !editingImage && <div className="image-ready"><button className="image-ready-preview" onClick={() => setEditingImage(true)} aria-label="再次編輯圖片"><img src={imageDraft.url} alt="待送出的題目圖片" /></button><span>{imageDraft.name}<small>已準備，點圖片可再調整</small></span><button onClick={() => setImageDraft(null)} aria-label="移除圖片">×</button></div>}
        <form className="composer" onSubmit={submit} onPaste={(event) => { const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile(); if (image) { event.preventDefault(); chooseQuestionImage(new File([image], `貼上的題目-${Date.now()}.png`, { type: image.type })); } }}>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { chooseQuestionImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <button className="attach-image" type="button" aria-label="上傳或貼上圖片問問題" title="上傳圖片，也可直接按 Ctrl+V 貼上" onClick={() => imageInputRef.current?.click()}>＋</button>
          <textarea
            ref={composerInputRef}
            aria-label="輸入你想學習的內容"
            placeholder={practiceQuestion && practiceDiscussion ? "針對本題自由追問；AI 會直接回答，不會再反問" : practiceQuestion && practiceCoachMessages.length > 0 ? "回答教練的問題；不知道也可以說卡在哪裡" : "告訴我你想學什麼，或直接貼上一道題目……"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (practiceQuestion && practiceCoachMessages.length > 0) void askPracticeCoach(input);
                else void send(input);
              }
            }}
            rows={1}
          />
          <button className="send-button" type="submit" aria-label="送出" disabled={(!input.trim() && !imageDraft) || thinking}>↑</button>
          <div className="composer-actions">
            <button className="composer-focus-button" type="button" onClick={() => setChatFocusMode((current) => !current)} aria-pressed={chatFocusMode} aria-label={chatFocusMode ? "還原對話視窗" : "放大對話視窗"}>{chatFocusMode ? "還原" : "放大"}</button>
            {currentMember?.canAdmin && <button className="composer-topic-button" type="button" onClick={() => void startNewTopic()} disabled={thinking || generatingStudentReply || evaluatingTeaching}>另開主題</button>}
          </div>
        </form>
      </div>

      {verificationOpen && <div className="professional-verification-backdrop" role="dialog" aria-modal="true" aria-labelledby="professional-verification-title"><section className="professional-verification-dialog"><div className="professional-verification-heading"><span>PROFESSIONAL LEGAL VERIFICATION</span><h2 id="professional-verification-title">AI 專業法學查證</h2><p>不是代替 Google，而是把最新官方資料整理成可用於考試的答案。</p></div><div className="professional-verification-value"><article><b>① 官方來源優先</b><span>司法院、憲法法庭、全國法規資料庫及政府機關</span></article><article><b>② 教材版本比對</b><span>標示一致、已有修正或可能過時</span></article><article><b>③ 考試化整理</b><span>轉成爭點、法條、判準與答題提醒</span></article><article><b>④ 可追溯結果</b><span>顯示來源名稱、連結、資料日期與查證時間</span></article></div><div className="professional-verification-notice"><strong>AI 方案已內含：每組 5 輪可使用 1 次</strong><span>無須另外購買，也不會額外扣次；只有按下確認才會搜尋外網。使用後，要等下一組 5 輪才會重新取得 1 次。</span></div><div className="professional-verification-actions"><button type="button" className="secondary" onClick={() => setVerificationOpen(false)}>回到一般教材回答</button><button type="button" onClick={() => { const question=input.trim(); setVerificationOpen(false); if(question) void send(question,undefined,{professionalVerification:true}); }} disabled={!input.trim() || thinking}>使用本組內含查證</button></div></section></div>}

      {imageDraft && editingImage && <div className="image-editor-backdrop" role="dialog" aria-modal="true" aria-label="編輯題目圖片"><section className="image-editor"><div className="image-editor-head"><div><strong>調整題目圖片</strong><span>拖曳方框四角或四邊調整範圍；拖曳框內可整體移動</span></div><button onClick={() => setImageDraft(null)} aria-label="關閉">×</button></div><div className={`crop-stage ${imageDraft.enhance ? "enhanced" : ""}`} ref={editorRef}><img src={imageDraft.url} alt="圖片裁切預覽" className={Math.abs(imageDraft.rotation / 90) % 2 === 1 ? "quarter-turn" : ""} style={{ "--image-rotation": `${imageDraft.rotation}deg` } as React.CSSProperties} />{(() => { const bounds = cropBounds(imageDraft.points); const handles: Array<{ name: CropHandle; x: number; y: number }> = [{ name: "nw", x: bounds.left, y: bounds.top }, { name: "n", x: (bounds.left + bounds.right) / 2, y: bounds.top }, { name: "ne", x: bounds.right, y: bounds.top }, { name: "e", x: bounds.right, y: (bounds.top + bounds.bottom) / 2 }, { name: "se", x: bounds.right, y: bounds.bottom }, { name: "s", x: (bounds.left + bounds.right) / 2, y: bounds.bottom }, { name: "sw", x: bounds.left, y: bounds.bottom }, { name: "w", x: bounds.left, y: (bounds.top + bounds.bottom) / 2 }]; return <><div className="crop-frame" style={{ left: `${bounds.left}%`, top: `${bounds.top}%`, width: `${bounds.right - bounds.left}%`, height: `${bounds.bottom - bounds.top}%` }} onPointerDown={(event) => { cropFrameDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, points: imageDraft.points.map((point) => ({ ...point })) }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveCropFrame(event.clientX, event.clientY); }} onPointerUp={() => { cropFrameDragRef.current = null; }}><span>保留範圍</span></div>{handles.map((handle) => <button key={handle.name} className={`crop-handle crop-handle-${handle.name}`} style={{ left: `${handle.x}%`, top: `${handle.y}%` }} aria-label={`調整裁切框 ${handle.name}`} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveCropHandle(handle.name, event.clientX, event.clientY); }} />)}</>; })()}</div><div className="image-tools"><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation - 90 } : current)}>↶ 左轉</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: current.rotation + 90 } : current)}>↷ 右轉</button><button className={imageDraft.enhance ? "active" : ""} onClick={() => setImageDraft((current) => current ? { ...current, enhance: !current.enhance } : current)}>✦ 加強圖片</button><button onClick={() => setImageDraft((current) => current ? { ...current, rotation: 0, enhance: false, points: [{ x: 6, y: 6 }, { x: 94, y: 6 }, { x: 94, y: 94 }, { x: 6, y: 94 }] } : current)}>重設</button></div><div className="image-editor-actions"><button className="secondary" onClick={() => setImageDraft(null)}>取消</button><button onClick={() => setEditingImage(false)}>使用這張圖片</button></div><p>線框內為實際保留範圍；送出時自動縮至最長邊 1600px，並壓縮為 JPEG。</p></section></div>}
    </main>
  );
}

export default function MainEntryGate() {
  type HomeCard = { id: "law" | "pengli" | "medtech" | "accounting"; enabled: boolean; order: number };
  const homeDefaults: HomeCard[] = [{ id: "pengli", enabled: true, order: 1 }, { id: "medtech", enabled: true, order: 2 }, { id: "accounting", enabled: true, order: 3 }, { id: "law", enabled: false, order: 4 }];
  const [homeCards, setHomeCards] = useState<HomeCard[]>(homeDefaults);
  useEffect(() => { void fetch("/api/portal-cards", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (Array.isArray(data.cards)) setHomeCards(data.cards); }).catch(() => undefined); }, []);
  const coverFallback = (fallback: string) => (event: React.SyntheticEvent<HTMLImageElement>) => { const image = event.currentTarget; if (!image.dataset.fallback) { image.dataset.fallback = "1"; image.src = fallback; } };
  return <main className="main-entry-gate main-portal">
    <div className="main-portal-orb main-portal-orb-one" aria-hidden="true" />
    <div className="main-portal-orb main-portal-orb-two" aria-hidden="true" />
    <section className="main-portal-shell">
      <header className="main-portal-head">
        <span><i aria-hidden="true" /> AI KNOWLEDGE SEARCH</span>
        <h1>iBrain Pedia <em>X</em></h1>
        <h2>智學百科｜智慧學習</h2>
      </header>
      <section className="main-teacher-zone" aria-labelledby="featured-teachers-title">
        <header className="main-teacher-zone-head">
          <div>
            <span>FEATURED MENTORS</span>
            <h2 id="featured-teachers-title">名師專區</h2>
          </div>
          <p>依類科找到老師，從專屬教材開始學習。</p>
        </header>
        <div className="main-teacher-list">
        {homeCards.filter((card) => card.enabled).sort((a, b) => a.order - b.order).map((card) => card.id === "pengli" ?
        <article className="main-teacher-card law-teacher" key={card.id}>
          <div className="main-teacher-cover">
            <img src="/api/portal-cards/cover?id=pengli" onError={coverFallback("/teachers/pengli-administrative-law-cover-v2.png")} alt="行政法考點（考前衝刺）演習書透明書封" />
          </div>
          <div className="main-teacher-content">
            <div className="main-teacher-tags"><span>法律類</span><span>行政法</span><span>司律二試</span></div>
            <small>彭狸老師專區</small>
            <h3>行政法考點衝刺</h3>
            <p>從熱門爭點、破題方法到申論擬答，把行政法從看得懂練到寫得出來。</p>
            <div className="main-teacher-features" aria-label="專區內容">
              <span><b>8</b> 大主題</span>
              <span>考點演練</span>
              <span>申論批改</span>
            </div>
          </div>
          <div className="main-teacher-actions" aria-label="彭狸老師專區入口">
            <Link className="main-teacher-enter" href="/teachers/pengli">進入專區 <b aria-hidden="true">↗</b></Link>
          </div>
        </article> : card.id === "medtech" ?
        <article className="main-teacher-card medtech-teacher" key={card.id}>
          <div className="main-teacher-cover">
            <img src="/api/portal-cards/cover?id=medtech" onError={coverFallback("/medtech-books/clinical-virology-lower.jpg")} alt="醫檢師國考題詳解臨床病毒學下冊書封" />
          </div>
          <div className="main-teacher-content">
            <div className="main-teacher-tags"><span>醫檢類</span><span>臨床病毒學</span><span>醫檢國考</span></div>
            <small>康情老師・醫檢國考系列</small>
            <h3>臨床病毒學題庫演練</h3>
            <p>以代表書帶進章節刷題、完整解析與老師語音，從一本書開始建立國考複習節奏。</p>
            <div className="main-teacher-features" aria-label="專區內容"><span><b>1,400+</b> 題</span><span>老師語音</span><span>錯題重練</span></div>
          </div>
          <div className="main-teacher-actions" aria-label="康情老師醫檢專區入口">
            <Link className="main-teacher-enter" href="/medtech">進入專區 <b aria-hidden="true">↗</b></Link>
          </div>
        </article> : card.id === "accounting" ?
        <article className="main-teacher-card accounting-teacher" key={card.id}>
          <div className="main-teacher-cover accounting-feature-cover">
            <img src="/api/portal-cards/cover?id=accounting" onError={coverFallback("/api/accounting/product/cover")} alt="會研所中級會計學題庫制霸書封" />
          </div>
          <div className="main-teacher-content">
            <div className="main-teacher-tags"><span>會計類</span><span>中級會計</span><span>會研所</span></div>
            <small>中會互動解題專區</small>
            <h3>中級會計題庫制霸</h3>
            <p>以章節題庫串連計算過程、老師解析、錯題重練與學習紀錄，讀完觀念立即進入考題。</p>
            <div className="main-teacher-features" aria-label="專區內容"><span><b>18</b> 章</span><span>計算詳解</span><span>錯題收藏</span></div>
          </div>
          <div className="main-teacher-actions" aria-label="中級會計專區入口">
            <Link className="main-teacher-enter" href="/accounting">進入專區 <b aria-hidden="true">↗</b></Link>
          </div>
        </article> :
        <article className="main-platform-strip" key={card.id}>
          <div className="main-platform-strip-icon" aria-hidden="true">律</div>
          <div><small>律師・司法官國考學習平台</small><h3>司律備考</h3><p>爭點學習、真題演練與申論解題，建立完整法律思考路徑。</p></div>
          <Link href="/law">進入學習平台 <b aria-hidden="true">↗</b></Link>
        </article>)}
        </div>
      </section>
      <footer className="main-portal-footer">
        <span>高點學習服務</span>
        <nav aria-label="高點學習服務">
          <a href="https://www.get.com.tw/">高點知識達</a>
          <a href="https://publish.get.com.tw/">高點文化</a>
          <a href="https://www.ibrain.com.tw/">知識達</a>
        </nav>
        <strong>
          iBrain Pedia X・智<a className="main-portal-secret-admin" href="/admin/library" aria-label="管理員登入">學</a>百科
        </strong>
      </footer>
    </section>
  </main>;
}
