"use client";
import { useEffect, useState } from "react";
import { RichQuestionEditor, SourceWorkspace } from "../RichQuestionEditor";
import "../question-bank.css";
import "../question-workbench.css";
import "./page.css";

type Category = "medtech" | "accounting";
type Question = {
  id: number; examType?: string; year: string; subject: string; questionNumber: string;
  stem: string; options: Record<string, string>; correctAnswer: string | null;
  explanation: string; teacherAnswer?: string; answerSource: string; status: string;
  isSimulation?: boolean; simulatedAnswer?: string; simulatedExplanation?: string;
  simulatedCompleteExplanation?: string; simulatedSource?: string; simulatedAnswerStatus?: string;
};

export default function QuestionWorkbenchPage({ category = "medtech" }: { category?: Category }) {
  const accounting = category === "accounting";
  const endpoint = accounting ? "/api/accounting/admin/questions" : "/api/medtech/admin/questions";
  const back = accounting ? "/accounting/admin" : "/medtech/admin";
  const [item, setItem] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { setNotice("缺少題目編號"); setLoading(false); return; }
    fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json() as { item?: Question; error?: string } }))
      .then(({ ok, data }) => { if (ok && data.item) setItem(data.item); else setNotice(data.error || "題目讀取失敗"); })
      .finally(() => setLoading(false));
  }, [endpoint]);

  async function save() {
    if (!item) return;
    setSaving(true); setNotice("正在儲存題目與版面…");
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
    setNotice(response.ok ? "已儲存。可繼續編輯或返回題庫。" : "儲存失敗，請稍後再試。");
    setSaving(false);
  }

  if (loading) return <main className="standalone-workbench-state">正在開啟題目工作台…</main>;
  if (!item) return <main className="standalone-workbench-state"><p>{notice}</p><a href={back}>返回管理後台</a></main>;
  const essay = item.examType === "essay";

  return <main className="standalone-workbench">
    <header><div><a href={back}>← 返回題庫</a><h1>題目工作台</h1><p>{item.year} 年 · {item.subject} · 第 {item.questionNumber} 題</p></div><div><span className={notice.startsWith("已儲存") ? "saved" : ""}>{notice}</span><button disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存題目"}</button></div></header>
    <section className="standalone-workbench-grid"><SourceWorkspace/><article className="standalone-question-editor">
      <div className="question-editor-meta"><label>年份<input value={item.year} onChange={event => setItem({ ...item, year: event.target.value })}/></label><label>科目<input value={item.subject} onChange={event => setItem({ ...item, subject: event.target.value })}/></label><label>題號<input value={item.questionNumber} onChange={event => setItem({ ...item, questionNumber: event.target.value })}/></label>{!essay && <label>{item.isSimulation ? "正式答案（老師確認）" : "正確答案"}<select value={item.correctAnswer ?? ""} onChange={event => setItem({ ...item, correctAnswer: event.target.value })}><option value="">未設定</option>{["A", "B", "C", "D"].map(letter => <option key={letter}>{letter}</option>)}</select></label>}</div>
      <RichQuestionEditor label="題幹" value={item.stem} onChange={stem => setItem({ ...item, stem })}/>
      {!essay && ["A", "B", "C", "D"].map(key => <RichQuestionEditor compact key={key} label={`選項 ${key}`} value={item.options[key] ?? ""} onChange={value => setItem({ ...item, options: { ...item.options, [key]: value } })}/>)}
      <RichQuestionEditor label={essay ? "老師解答／解析" : "解析"} value={essay ? (item.teacherAnswer || item.explanation) : item.explanation} onChange={value => setItem(essay ? { ...item, teacherAnswer: value, explanation: value } : { ...item, explanation: value })}/>
      <label className="source-label">答案來源<input value={item.answerSource} onChange={event => setItem({ ...item, answerSource: event.target.value })}/></label>
      {item.isSimulation && !essay && <section className="simulation-workbench-fields"><h2>AI 模擬答案與解析（後台審核區）</h2><p>這些內容不會混入題目原有簡要解析；老師確認正式答案後，才可作為學生端正式解析依據。</p><label className="source-label">AI 模擬答案<select value={item.simulatedAnswer ?? ""} onChange={event => setItem({ ...item, simulatedAnswer: event.target.value })}><option value="">尚未產生</option>{["A", "B", "C", "D"].map(letter => <option key={letter}>{letter}</option>)}</select></label><RichQuestionEditor label="模擬解析" value={item.simulatedExplanation ?? ""} onChange={value => setItem({ ...item, simulatedExplanation: value })}/><RichQuestionEditor label="模擬完整解析" value={item.simulatedCompleteExplanation ?? ""} onChange={value => setItem({ ...item, simulatedCompleteExplanation: value })}/><label className="source-label">模擬依據註記<input value={item.simulatedSource ?? ""} onChange={event => setItem({ ...item, simulatedSource: event.target.value })}/></label><small className="simulation-status-note">狀態：{item.simulatedAnswerStatus || "missing"}{item.simulatedAnswer && item.correctAnswer ? ` · AI ${item.simulatedAnswer === item.correctAnswer ? "答對" : "答錯"}` : " · 待老師批改"}</small></section>}
      <footer><button disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存題目"}</button></footer>
    </article></section>
  </main>;
}
