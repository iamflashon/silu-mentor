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
  explanation: string; teacherAnswer?: string; aiCompleteExplanation?: string; teacherCompleteExplanation?: string; completeExplanation?: string; voiceScript?: string; answerSource: string; status: string;
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
  const [aiGenerating, setAiGenerating] = useState(false);
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

  async function generateAiSimulation() {
    if (!item || accounting) return;
    const optionsReady = ["A", "B", "C", "D"].every((letter) => String(item.options?.[letter] ?? "").trim());
    if (!item.stem.trim() || !optionsReady) {
      setNotice("請先確認題幹與 A～D 選項都已填寫，再產生 AI 擬答。");
      return;
    }
    setAiGenerating(true);
    setNotice("AI 正在依題幹與 A～D 選項產生擬答與完整解析…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, force: true }),
      });
      const data = await response.json() as { item?: Partial<Question> & { optionsJson?: string }; error?: string };
      if (!response.ok || !data.item) {
        setNotice(data.error || "AI 擬答產生失敗，請稍後再試。");
        return;
      }
      const returned = data.item;
      let options = item.options;
      if (returned.options && typeof returned.options === "object") options = returned.options;
      else if (returned.optionsJson) {
        try { options = JSON.parse(returned.optionsJson) as Record<string, string>; } catch { /* keep current options */ }
      }
      const { optionsJson: _optionsJson, ...generated } = returned;
      const next = { ...item, ...generated, options } as Question;
      setItem(next);
      setNotice("AI 擬答與 AI 完整解析已產生，請老師核對後再填入老師版。");
    } catch {
      setNotice("AI 擬答請求失敗，請稍後再試。");
    } finally {
      setAiGenerating(false);
    }
  }

  if (loading) return <main className="standalone-workbench-state">正在開啟題目工作台…</main>;
  if (!item) return <main className="standalone-workbench-state"><p>{notice}</p><a href={back}>返回管理後台</a></main>;
  const essay = item.examType === "essay";

  return <main className="standalone-workbench">
    <header><div><a href={back}>← 返回題庫</a><h1>題目工作台</h1><p>{item.year} 年 · {item.subject} · 第 {item.questionNumber} 題</p></div><div><span className={notice.startsWith("已儲存") ? "saved" : ""}>{notice}</span><button disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存題目"}</button></div></header>
    <section className="standalone-workbench-grid"><SourceWorkspace/><article className="standalone-question-editor">
      <div className="question-editor-meta"><label>年份<input value={item.year} onChange={event => setItem({ ...item, year: event.target.value })}/></label><label>科目<input value={item.subject} onChange={event => setItem({ ...item, subject: event.target.value })}/></label><label>題號<input value={item.questionNumber} onChange={event => setItem({ ...item, questionNumber: event.target.value })}/></label></div>
      {!essay && <div className="answer-version-grid"><div className="answer-version-card ai-answer-card"><span>AI 擬答（AI 版）</span><strong>{item.simulatedAnswer || "尚未產生"}</strong><small>AI 獨立判斷；老師答案僅供比對</small><button type="button" className="ai-generate-button" disabled={aiGenerating} onClick={() => void generateAiSimulation()}>{aiGenerating ? "AI 產生中…" : "AI 產生答案與解析"}</button></div><label className="answer-version-card teacher-answer-card"><span>老師答案（老師版）</span><select value={item.teacherAnswer || item.correctAnswer || ""} onChange={event => setItem({ ...item, teacherAnswer: event.target.value, correctAnswer: event.target.value || null })}><option value="">尚未確認</option>{["A", "B", "C", "D"].map(letter => <option key={letter}>{letter}</option>)}</select><small>{item.teacherAnswer || item.correctAnswer ? "已設定老師答案，前台會優先使用" : "尚未設定；前台才會使用 AI 擬答並標示"}</small></label></div>}
      <RichQuestionEditor label="題幹" value={item.stem} onChange={stem => setItem({ ...item, stem })}/>
      {!essay && ["A", "B", "C", "D"].map(key => <RichQuestionEditor compact key={key} label={`選項 ${key}`} value={item.options[key] ?? ""} onChange={value => setItem({ ...item, options: { ...item.options, [key]: value } })}/>)}
      {!essay && <RichQuestionEditor label="解析（題目原有簡要解析）" value={item.explanation} onChange={value => setItem({ ...item, explanation: value })}/>} 
      {essay && <RichQuestionEditor label="老師解答／解析" value={item.teacherAnswer || item.explanation} onChange={value => setItem({ ...item, teacherAnswer: value, explanation: value })}/>} 
      {!essay && <section className="simulation-workbench-fields explanation-version-fields"><h2>解析版本</h2><p>AI 版與老師版分開保存；老師完整解析完成後可直接作為語音解析文字。</p><RichQuestionEditor label="AI 完整解析（AI 版／待老師核對）" value={item.aiCompleteExplanation || (item.isSimulation ? (item.simulatedCompleteExplanation || "") : "")} onChange={value => setItem(item.isSimulation ? { ...item, simulatedCompleteExplanation: value, aiCompleteExplanation: value } : { ...item, aiCompleteExplanation: value })}/><RichQuestionEditor label="老師完整解析（老師版）" value={item.teacherCompleteExplanation || ""} onChange={value => setItem({ ...item, teacherCompleteExplanation: value })}/></section>}
      <label className="source-label">答案來源<input value={item.answerSource} onChange={event => setItem({ ...item, answerSource: event.target.value })}/></label>
      {!essay && <section className="simulation-workbench-fields"><h2>AI 擬答審核</h2><p>AI 會獨立判斷，不會因為已有老師答案就直接照抄；若不同，會保留差異供老師確認。</p><label className="source-label">AI 擬答<select value={item.simulatedAnswer ?? ""} onChange={event => setItem({ ...item, simulatedAnswer: event.target.value })}><option value="">尚未產生</option>{["A", "B", "C", "D"].map(letter => <option key={letter}>{letter}</option>)}</select></label><RichQuestionEditor label="AI 簡要解析" value={item.simulatedExplanation ?? ""} onChange={value => setItem({ ...item, simulatedExplanation: value })}/><label className="source-label">AI 依據註記<input value={item.simulatedSource ?? ""} onChange={event => setItem({ ...item, simulatedSource: event.target.value })}/></label><small className="simulation-status-note">狀態：{item.simulatedAnswerStatus || "missing"}{item.simulatedAnswer && (item.teacherAnswer || item.correctAnswer) ? ` · AI ${item.simulatedAnswer === (item.teacherAnswer || item.correctAnswer) ? "答對" : "答錯"}` : " · 待老師批改"}</small></section>}
      <footer><button disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存題目"}</button></footer>
    </article></section>
  </main>;
}
