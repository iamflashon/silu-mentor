"use client";

import { useState } from "react";
import "./ManualQuestionDialog.css";

type CreatedQuestion = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  teacherAnswer?: string;
  explanation: string;
  answerSource: string;
  status: string;
  sourceOrder?: number | null;
};

export function ManualQuestionDialog({
  documentId,
  subject,
  disabled,
  onCreated,
}: {
  documentId: number;
  subject: string;
  disabled?: boolean;
  onCreated: (question: CreatedQuestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    year: "模擬",
    questionNumber: "",
    sourceOrder: "",
    stem: "",
    A: "",
    B: "",
    C: "",
    D: "",
    answer: "",
    explanation: "",
  });

  function reset() {
    setForm({ year: "模擬", questionNumber: "", sourceOrder: "", stem: "", A: "", B: "", C: "", D: "", answer: "", explanation: "" });
    setError("");
  }

  async function submit() {
    if (!form.questionNumber.trim() || !form.stem.trim() || [form.A, form.B, form.C, form.D].some((value) => !value.trim())) {
      setError("請填寫題號、題幹與 A～D 四個選項。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId,
          subject,
          year: form.year,
          questionNumber: form.questionNumber,
          sourceOrder: form.sourceOrder,
          stem: form.stem,
          options: { A: form.A, B: form.B, C: form.C, D: form.D },
          answer: form.answer,
          explanation: form.explanation,
        }),
      });
      const data = await response.json() as { item?: CreatedQuestion; error?: string };
      if (!response.ok || !data.item) {
        setError(data.error || "新增題目失敗");
        return;
      }
      onCreated(data.item);
      setOpen(false);
      reset();
    } catch {
      setError("新增題目失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="manual-question-trigger" disabled={disabled} onClick={() => setOpen(true)}>
        手動新增題目
      </button>
      {open && (
        <div className="manual-question-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section className="manual-question-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-question-title">
            <header>
              <div>
                <h2 id="manual-question-title">手動新增題目</h2>
                <p>新增後會綁定在目前文件「{subject}」內，不會重新拆解其他題目。</p>
              </div>
              <button type="button" className="manual-question-close" onClick={() => setOpen(false)} aria-label="關閉">×</button>
            </header>
            <div className="manual-question-grid">
              <label>考試來源／年份<input value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} /></label>
              <label>題號<input value={form.questionNumber} onChange={(event) => setForm({ ...form, questionNumber: event.target.value })} placeholder="例如 34" /></label>
              <label>原稿順序（選填）<input inputMode="numeric" value={form.sourceOrder} onChange={(event) => setForm({ ...form, sourceOrder: event.target.value })} placeholder="例如 34、87、94" /></label>
            </div>
            <label className="manual-question-wide">題幹<textarea value={form.stem} onChange={(event) => setForm({ ...form, stem: event.target.value })} rows={3} /></label>
            <div className="manual-option-grid">
              {(["A", "B", "C", "D"] as const).map((key) => <label key={key}>選項 {key}<textarea value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} rows={2} /></label>)}
            </div>
            <div className="manual-question-grid">
              <label>答案<select value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })}><option value="">尚未設定</option>{["A", "B", "C", "D"].map((key) => <option key={key}>{key}</option>)}</select></label>
              <label className="manual-question-wide-inline">簡要解析（選填）<textarea value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} rows={2} /></label>
            </div>
            <p className="manual-question-hint">若要補回三回各40題：第1回第34題的原稿順序填34；第3回第7題填87；第3回第14題填94。</p>
            {error && <p className="manual-question-error">{error}</p>}
            <footer><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="manual-question-save" disabled={saving} onClick={() => void submit()}>{saving ? "新增中…" : "新增並加入題庫"}</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
