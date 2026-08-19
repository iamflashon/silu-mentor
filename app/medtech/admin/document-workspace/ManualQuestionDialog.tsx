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

function parsePastedQuestion(value: string) {
  const text = value.replace(/\r/gu, "").trim();
  const number = text.match(/^\s*(\d{1,3})\s*[.、)．]/u)?.[1] ?? "";
  const markerPattern = /(?:\(([ABCD])\)|（([ABCD])）|(?:^|\n)\s*([ABCD])\s*[.．、:：)])\s*/gim;
  const markers = [...text.matchAll(markerPattern)].slice(0, 4);
  if (markers.length < 4) return { error: "找不到完整的 A～D 選項，請確認每個選項前有 (A)～(D) 或 A.～D.。" };
  const options: Record<string, string> = {};
  const first = markers[0];
  const stem = text.slice(0, first.index ?? 0).replace(/^\s*\d{1,3}\s*[.、)．]\s*/u, "").trim();
  markers.forEach((marker, index) => {
    const key = marker[1] ?? marker[2] ?? marker[3] ?? "";
    const start = (marker.index ?? 0) + marker[0].length;
    const end = index < markers.length - 1 ? (markers[index + 1].index ?? text.length) : text.length;
    options[key] = text.slice(start, end).trim();
  });
  if (!stem || ["A", "B", "C", "D"].some((key) => !options[key])) return { error: "題幹或選項內容是空的，請確認貼上的文字完整。" };
  return { number, stem, options };
}

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
  const [pasteText, setPasteText] = useState("");
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
    setPasteText("");
    setError("");
  }

  function applyPastedQuestion() {
    const parsed = parsePastedQuestion(pasteText);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setForm((current) => ({ ...current, questionNumber: current.questionNumber || parsed.number, stem: parsed.stem ?? current.stem, A: parsed.options?.A ?? current.A, B: parsed.options?.B ?? current.B, C: parsed.options?.C ?? current.C, D: parsed.options?.D ?? current.D }));
    setError("");
  }

  async function submit() {
    const hasAnyContent = Boolean(form.stem.trim() || [form.A, form.B, form.C, form.D].some((value) => value.trim()));
    if (!form.questionNumber.trim()) {
      setError("請先填寫題號。");
      return;
    }
    if (!hasAnyContent && !form.sourceOrder.trim()) {
      setError("若要先建立空白題，請填寫原稿順序；之後可再回題目編輯補內容。");
      return;
    }
    if (hasAnyContent && (!form.stem.trim() || [form.A, form.B, form.C, form.D].some((value) => !value.trim()))) {
      setError("若已開始填內容，請補齊題幹與 A～D 四個選項；或清空內容後只先建立題號與順序。");
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
      window.dispatchEvent(new CustomEvent("medtech-question-created", { detail: { id: data.item.id } }));
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
            <div className="manual-question-paste">
              <label>快速貼上整題原文（可選）<textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={5} placeholder="例如：34. 題幹文字\n(A) 選項一\n(B) 選項二\n(C) 選項三\n(D) 選項四" /></label>
              <button type="button" onClick={applyPastedQuestion}>自動分出題幹與選項</button>
            </div>
            <label className="manual-question-wide">題幹<textarea value={form.stem} onChange={(event) => setForm({ ...form, stem: event.target.value })} rows={3} /></label>
            <div className="manual-option-grid">
              {(["A", "B", "C", "D"] as const).map((key) => <label key={key}>選項 {key}<textarea value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} rows={2} /></label>)}
            </div>
            <div className="manual-question-grid">
              <label>答案<select value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })}><option value="">尚未設定</option>{["A", "B", "C", "D"].map((key) => <option key={key}>{key}</option>)}</select></label>
              <label className="manual-question-wide-inline">簡要解析（選填）<textarea value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} rows={2} /></label>
            </div>
            <p className="manual-question-hint">可以只填「題號＋原稿順序」先建立空白草稿，之後再回題目編輯補題幹、選項、答案與解析。若要補回三回各40題：第1回第34題→題號34／順序34；第3回第7題→題號7／順序87；第3回第14題→題號14／順序94。</p>
            {error && <p className="manual-question-error">{error}</p>}
            <footer><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="manual-question-save" disabled={saving} onClick={() => void submit()}>{saving ? "新增中…" : form.stem.trim() ? "新增並加入題庫" : "先建立題號與順序"}</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
