"use client";

import { useState } from "react";

type Conflict = { teacherAnswer: string; aiAnswer: string; recommendation: "teacher" | "ai" | "ambiguous"; reason: string };

export function AnswerConflictPanel({ questionId, questionNumber, teacherAnswer, aiAnswer, note, onUpdated }: { questionId: number; questionNumber: string; teacherAnswer?: string; aiAnswer?: string; note?: string; onUpdated?: (item: Record<string, unknown>) => void }) {
  const teacher = String(teacherAnswer || "").trim().toUpperCase();
  const ai = String(aiAnswer || "").trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Conflict | null>(null);
  const [message, setMessage] = useState("");
  const different = /^[A-D]$/.test(teacher) && /^[A-D]$/.test(ai) && teacher !== ai;
  if (!different && !report) return null;

  async function investigate() {
    setBusy(true);
    setMessage("正在重新檢查題幹、選項與答案差異…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: questionId, action: "investigate" }) });
      const data = await response.json() as { conflict?: Conflict; item?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.conflict) { setMessage(data.error || "答案差異調查失敗，請稍後再試。"); return; }
      setReport(data.conflict);
      if (data.item) onUpdated?.(data.item);
      setMessage("調查完成；正式答案尚未自動變更，請老師確認。");
    } catch {
      setMessage("答案差異調查失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "keep_teacher" | "use_ai" | "pending") {
    const labels = { keep_teacher: `維持老師答案 ${teacher}`, use_ai: `改採 AI 答案 ${ai}`, pending: "暫不決定" };
    if (!window.confirm(`確定${labels[decision]}嗎？${decision === "use_ai" ? "這會把 AI 答案寫入老師答案，並需要重新校對。" : decision === "keep_teacher" ? "系統會保留老師答案，並記錄這次差異調查。" : "系統會保留差異警告，不會發布本題。"}`)) return;
    setBusy(true);
    setMessage("正在保存老師確認結果…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: questionId, action: "teacherDecision", decision }) });
      const data = await response.json() as { item?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.item) { setMessage(data.error || "老師確認結果保存失敗。"); return; }
      onUpdated?.(data.item);
      setMessage(decision === "use_ai" ? "已採用 AI 答案；請重新校對後再發布。" : decision === "keep_teacher" ? "已保留老師答案，並記錄差異調查結果。" : "已保留答案差異，尚未做出正式決定。");
    } catch {
      setMessage("老師確認結果保存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="answer-conflict-panel" aria-live="polite">
    <div className="answer-conflict-head"><div><b>答案差異警告</b><small>第 {questionNumber || questionId} 題：老師答案 {teacher}，AI 答案 {ai}。系統不會自動覆蓋老師答案。</small></div><button type="button" disabled={busy} onClick={() => void investigate()}>{busy ? "處理中…" : report ? "重新調查" : "調查 AI／老師答案差異"}</button></div>
    {note && !report && <p className="answer-conflict-note">上次調查紀錄：{note}</p>}
    {report && <div className="answer-conflict-report"><p><b>AI 調查結論：</b>{report.recommendation === "teacher" ? "暫維持老師答案，建議優先檢查 AI 是否套用錯誤原理。" : report.recommendation === "ai" ? "建議老師重新檢查教材答案，AI 答案可能較合理。" : "題目或答案可能有歧義，建議人工查核原始教材。"}</p><p>{report.reason}</p><div className="answer-conflict-decisions"><button type="button" disabled={busy} onClick={() => void decide("keep_teacher")}>維持老師答案 {teacher}</button><button type="button" disabled={busy} onClick={() => void decide("use_ai")}>改採 AI 答案 {ai}</button><button type="button" className="secondary" disabled={busy} onClick={() => void decide("pending")}>暫不決定</button></div></div>}
    {message && <small className="answer-conflict-message">{message}</small>}
  </section>;
}
