import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import MedtechHeaderActions from "../../MedtechHeaderActions";
import MedtechTabs from "../../MedtechTabs";
import { guidedPracticeSessions } from "../../../../db/schema";
import { chatGPTSignInPath } from "../../../chatgpt-auth";
import { requireMedtechMember } from "../../../../lib/member-auth";

type GuidedMessage = { role?: string; text?: string; source?: string; usage?: { model?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; estimatedCostUsd?: number } };
type GuidedEvent = { type?: string; label?: string; detail?: string; at?: string };
type GuidedQuestion = { year?: string; questionNumber?: string; topic?: string; stem?: string; options?: Record<string, string>; correctAnswer?: string };
type GuidedState = { question?: GuidedQuestion; level?: string; selectedAnswer?: string; correct?: boolean | null; hintUsed?: boolean; comparisonUsed?: boolean; voiceUnlocked?: boolean; messages?: GuidedMessage[]; events?: GuidedEvent[]; startedAt?: string; lastActivityAt?: string; elapsedSeconds?: number };

function parseState(raw: string): GuidedState {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value as GuidedState : {};
  } catch {
    return {};
  }
}

function dateText(value: Date | string | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
}

function durationText(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes} 分 ${total % 60} 秒` : `${total} 秒`;
}

export default async function MedtechAiStudyHistory() {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech/ai-study/history", { headers: requestHeaders }));
  if ("error" in auth) {
    return <main className="medtech-member-page"><section className="medtech-member-card login"><span>醫檢師引導學習紀錄</span><h1>登入後查看學習過程</h1><p>登入後可保存每一道題的提示、作答、比較選項、老師語音與 AI 追問過程。</p><a className="primary" href={chatGPTSignInPath("/medtech/ai-study/history")}>登入醫檢師備考</a></section></main>;
  }

  const rows = await auth.db.select({ questionId: guidedPracticeSessions.questionId, mode: guidedPracticeSessions.mode, status: guidedPracticeSessions.status, stateJson: guidedPracticeSessions.stateJson, createdAt: guidedPracticeSessions.createdAt, updatedAt: guidedPracticeSessions.updatedAt }).from(guidedPracticeSessions).where(eq(guidedPracticeSessions.userKey, auth.userKey)).orderBy(desc(guidedPracticeSessions.updatedAt)).limit(100);
  const records = rows.map((row) => ({ ...row, state: parseState(row.stateJson) }));

  return <main className="medtech-practice"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>AI STUDY HISTORY</small></div></a><MedtechHeaderActions /></header><MedtechTabs active="guided"/><section className="medtech-guided-history-shell"><header className="medtech-guided-history-heading"><div><span>GUIDED STUDY HISTORY</span><h1>引導學習紀錄</h1><p>每一道題獨立保存完整學習過程，不與刷題包紀錄混在一起。</p></div><a href="/medtech/ai-study">回到引導學習</a></header>{records.length ? <div className="medtech-guided-history-list">{records.map((record) => { const state = record.state; const q = state.question; const selected = state.selectedAnswer || "未作答"; const correctAnswer = q?.correctAnswer || "未設定"; const correct = state.correct === true; const features = [state.hintUsed && "提示", state.comparisonUsed && "比較選項", state.voiceUnlocked && "老師語音"].filter(Boolean).join("、") || "尚未使用進階功能"; return <details className="medtech-guided-history-card" key={record.questionId}><summary><div className="medtech-guided-history-summary"><strong>{q?.year || "醫檢師題目"} · 第 {q?.questionNumber || record.questionId} 題</strong><span>{q?.topic || "引導學習"} · 最後活動：{dateText(record.updatedAt)}</span></div><span>{record.status === "completed" ? "已完成" : "進行中"}</span></summary><div className="medtech-guided-history-body"><div className="medtech-guided-history-meta"><span className={correct ? "" : state.selectedAnswer ? "critical" : ""}>{state.selectedAnswer ? `你的答案：${selected}｜${correct ? "答對" : "答錯"}` : "尚未作答"}</span><span>正確答案：{correctAnswer}</span><span>學習程度：{state.level || "入門"}</span><span>學習時間：{durationText(state.elapsedSeconds)}</span><span>功能：{features}</span></div><section className="medtech-guided-question"><h2>{q?.stem || "本題題幹已保存於學習紀錄中。"}</h2><div className="medtech-guided-options">{Object.entries(q?.options || {}).map(([letter, text]) => <div className={`${letter === selected ? "selected " : ""}${letter === correctAnswer ? "correct" : ""}`} key={letter}><b>{letter}</b><span>{text}{letter === selected ? " · 你的答案" : ""}{letter === correctAnswer ? " · 正確答案" : ""}</span></div>)}</div></section><div className="medtech-guided-history-columns"><section className="medtech-guided-history-panel"><h3>學習流程</h3><ol className="medtech-guided-event-list">{(state.events || []).map((event, index) => <li key={`${event.at || "event"}-${index}`}><time>{dateText(event.at)}</time><span><b>{event.label || event.type || "學習動作"}</b>{event.detail ? `：${event.detail}` : ""}</span></li>)}</ol>{!state.events?.length && <p>尚無事件紀錄。</p>}</section><section className="medtech-guided-history-panel"><h3>完整對話與解析</h3><ul className="medtech-guided-message-list">{(state.messages || []).map((message, index) => <li className={message.role === "student" ? "student" : ""} key={`${message.role || "message"}-${index}`}><b>{message.role === "student" ? "我" : "醫檢 AI 助教"}</b><br />{message.text || ""}{message.usage && <small>{message.usage.model || "Luna"} · {(message.usage.inputTokens || 0) + (message.usage.outputTokens || 0)} tokens · 約 NT$ {((message.usage.estimatedCostUsd || 0) * 32.5).toFixed(3)}</small>}</li>)}</ul>{!state.messages?.length && <p>尚無對話紀錄。</p>}</section></div><small>本題開始：{dateText(state.startedAt || record.createdAt)} · 最近更新：{dateText(state.lastActivityAt || record.updatedAt)}</small></div></details>; })}</div> : <div className="medtech-guided-history-empty">目前還沒有引導學習紀錄。抽一道題、選擇答案或取得提示後，系統就會自動保存完整過程。</div>}</section></main>;
}
