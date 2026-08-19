"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatTwd } from "../../lib/currency";
import { supportsIssuePractice } from "../../lib/issue-practice-subjects";
import "./selection-tools.css";

type Question = { id: number; year: string; examName: string; subject: string; questionNumber: string; stem: string; answerSource: string };
type SampleLevel = "basic" | "intermediate" | "advanced";
type Result = { analysis: string; model: string; modelId: string; reason: string; answerSource: string; sampleLabel?: string | null; usage: { inputTokens: number; outputTokens: number; cachedTokens: number; estimatedCostUsd: number; durationMs: number } };
type WorkflowResult = { analysis: string; model: string; usage: Result["usage"] };
type Workflow = { solReview?: WorkflowResult; challenger?: "terra" | "sonnet"; challenge?: WorkflowResult; lunaReply?: WorkflowResult; solReply?: WorkflowResult };
type SavedRecord = { studentIssues: string; studentSupplement: string; sampleLevel?: SampleLevel | null; lunaResult: Result | null; solResult: Result | null; challengeWorkflow?: Workflow; updatedAt: string };
type LegalArticle = { title: string; articleNo: string; hierarchy?: string; content: string; modifiedDate?: string; sourceUrl?: string };
type PersonalQuestion = { id: number; title: string; subject: string; sourceLabel: string; questionText: string; preview?: string; imageUrl?: string | null; imageUrls?: string[]; updatedAt: string };
type PhotoDraft = { id: string; name: string; sourceUrl: string; dataUrl: string; width: number; height: number; rotation: number; crop: { left: number; top: number; right: number; bottom: number }; ocrText: string };

function cleanAnalysisLine(line: string) {
  return line.replace(/^\s{0,3}#{1,6}\s*/u, "").replace(/^\s*```(?:\w+)?\s*$/u, "").replace(/\*\*([^*]+)\*\*/gu, "$1").replace(/__([^_]+)__/gu, "$1").replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "$1").replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "$1").replace(/`([^`]+)`/gu, "$1").replace(/\*\*/gu, "").trim();
}

function questionSummary(stem: string, maxLength = 34) {
  const summary = stem.replace(/\s+/gu, " ").trim();
  return summary.length > maxLength ? `${summary.slice(0, maxLength)}…` : summary;
}

function parseIssueAnalysis(analysis: string) {
  const scoreMatch = analysis.match(/(?:爭點辨識)?完成度\s*(?:[：:]|約為?|達)?\s*(\d{1,3})\s*分/u);
  const levelMatch = analysis.match(/程度判定\s*[：:]\s*(基礎|中等|高分)/u);
  const scorePattern = /[；;，,。\s]*(?:爭點辨識)?完成度\s*(?:[：:]|約為?|達)?\s*\d{1,3}\s*分[；;，,。\s]*/gu;
  const levelPattern = /[；;，,。\s]*程度判定\s*[：:]\s*(?:基礎|中等|高分)[；;，,。\s]*/gu;
  return {
    score: scoreMatch?.[1] ?? null,
    level: levelMatch?.[1] ?? null,
    lines: analysis.replace(scorePattern, "").replace(levelPattern, "").split("\n"),
  };
}

function PhotoCropEditor({ photo, index, onCancel, onApply }: { photo: PhotoDraft; index: number; onCancel: () => void; onApply: (photo: PhotoDraft) => void }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(photo);
  function move(handle: "nw" | "ne" | "se" | "sw", clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect(); if (!rect) return;
    const x = Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)); const y = Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100));
    setDraft((current) => { const crop = { ...current.crop }; if (handle.includes("n")) crop.top = Math.min(y, crop.bottom - 8); if (handle.includes("s")) crop.bottom = Math.max(y, crop.top + 8); if (handle.includes("w")) crop.left = Math.min(x, crop.right - 8); if (handle.includes("e")) crop.right = Math.max(x, crop.left + 8); return { ...current, crop }; });
  }
  const handles = [{ key: "nw", x: draft.crop.left, y: draft.crop.top }, { key: "ne", x: draft.crop.right, y: draft.crop.top }, { key: "se", x: draft.crop.right, y: draft.crop.bottom }, { key: "sw", x: draft.crop.left, y: draft.crop.bottom }] as const;
  const quarterTurn = Math.abs(draft.rotation / 90) % 2 === 1; const ratio = quarterTurn ? draft.height / draft.width : draft.width / draft.height;
  const imageStyle = quarterTurn ? { width: `${100 / ratio}%`, height: `${100 * ratio}%`, left: "50%", top: "50%", transform: `translate(-50%,-50%) rotate(${draft.rotation}deg)` } : { width: "100%", height: "100%", left: 0, top: 0, transform: `rotate(${draft.rotation}deg)` };
  return <div className="personal-crop-backdrop" role="dialog" aria-modal="true" aria-label={`調整第 ${index + 1} 張圖片`}><section className="personal-crop-editor"><header><div><b>調整第 {index + 1} 張</b><span>拖曳四角決定保留範圍；旋轉後會完整顯示</span></div><button type="button" onClick={onCancel}>×</button></header><div className={`personal-crop-stage ${quarterTurn ? "quarter-turn" : ""}`} ref={stageRef} style={{ aspectRatio: String(ratio), width: `min(100%, calc(60dvh * ${ratio}))` }}><img src={draft.sourceUrl} alt="裁切預覽" style={imageStyle} /><div className="personal-crop-frame" style={{ left: `${draft.crop.left}%`, top: `${draft.crop.top}%`, width: `${draft.crop.right - draft.crop.left}%`, height: `${draft.crop.bottom - draft.crop.top}%` }}><span>保留範圍</span></div>{handles.map((handle) => <button type="button" key={handle.key} className="personal-crop-handle" style={{ left: `${handle.x}%`, top: `${handle.y}%` }} aria-label={`拖曳${handle.key}裁切點`} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(handle.key, event.clientX, event.clientY); }} />)}</div><div className="personal-crop-tools"><button type="button" onClick={() => setDraft((current) => ({ ...current, rotation: current.rotation - 90, crop: { left: 4, top: 4, right: 96, bottom: 96 } }))}>↶ 左轉</button><button type="button" onClick={() => setDraft((current) => ({ ...current, rotation: current.rotation + 90, crop: { left: 4, top: 4, right: 96, bottom: 96 } }))}>↷ 右轉</button><button type="button" onClick={() => setDraft({ ...photo, rotation: 0, crop: { left: 4, top: 4, right: 96, bottom: 96 } })}>重設</button></div><footer><button type="button" className="secondary" onClick={onCancel}>取消</button><button type="button" onClick={() => onApply(draft)}>使用這個範圍</button></footer></section></div>;
}

function PersonalIssuePractice({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [questions, setQuestions] = useState<PersonalQuestion[]>([]);
  const [active, setActive] = useState<PersonalQuestion | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [editingPhoto, setEditingPhoto] = useState<number | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("刑法");
  const [sourceLabel, setSourceLabel] = useState("我的書籍");
  const [studentIssues, setStudentIssues] = useState("");
  const [issueSuggestion, setIssueSuggestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState<"ocr" | "save" | "load" | "suggest" | "analyze" | null>(null);
  const [error, setError] = useState("");
  const subjects = ["公法", "民法", "民訴", "刑法", "刑訴", "商法", "未分類"];

  async function refresh(query = keyword) {
    const response = await fetch(`/api/issue-practice/personal?q=${encodeURIComponent(query)}`); const data = await response.json();
    if (response.ok) setQuestions(data.questions || []); else setError(data.error || "讀取失敗");
  }
  useEffect(() => {
    void fetch("/api/issue-practice/personal").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "讀取失敗");
      setQuestions(data.questions || []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "讀取失敗"));
  }, []);

  function loadImage(file?: File | null) {
    if (!file || !file.type.startsWith("image/")) return setError("請選擇 JPG、PNG 或 WebP 圖片");
    if (photos.length >= 2) return setError("每題最多上傳 2 張圖片");
    const reader = new FileReader(); reader.onload = () => {
      const image = new Image(); image.onload = () => {
        const scale = Math.min(1, 1800 / Math.max(image.width, image.height)); const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d"); if (!context) return setError("圖片處理失敗");
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", .82);
        setPhotos((current) => [...current, { id: crypto.randomUUID(), name: file.name || `第 ${current.length + 1} 張`, sourceUrl: dataUrl, dataUrl, width: canvas.width, height: canvas.height, rotation: 0, crop: { left: 4, top: 4, right: 96, bottom: 96 }, ocrText: "" }]);
        setOcrText(""); setActive(null); setResult(null); setStudentIssues(""); setError("");
      }; image.onerror = () => setError("圖片讀取失敗，請重新拍攝"); image.src = String(reader.result ?? "");
    }; reader.readAsDataURL(file);
  }
  async function renderPhoto(photo: PhotoDraft) {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = photo.sourceUrl; });
    const quarterTurn = Math.abs(photo.rotation / 90) % 2 === 1;
    const rotated = document.createElement("canvas"); rotated.width = quarterTurn ? image.height : image.width; rotated.height = quarterTurn ? image.width : image.height;
    const context = rotated.getContext("2d"); if (!context) throw new Error("圖片處理失敗");
    context.translate(rotated.width / 2, rotated.height / 2); context.rotate(photo.rotation * Math.PI / 180); context.drawImage(image, -image.width / 2, -image.height / 2);
    const { left, top, right, bottom } = photo.crop; const x = Math.round(rotated.width * left / 100); const y = Math.round(rotated.height * top / 100);
    const width = Math.max(1, Math.round(rotated.width * (right - left) / 100)); const height = Math.max(1, Math.round(rotated.height * (bottom - top) / 100));
    const output = document.createElement("canvas"); const scale = Math.min(1, 1800 / Math.max(width, height)); output.width = Math.round(width * scale); output.height = Math.round(height * scale);
    output.getContext("2d")?.drawImage(rotated, x, y, width, height, 0, 0, output.width, output.height); return output.toDataURL("image/jpeg", .82);
  }
  async function recognize() {
    if (!photos.length || loading) return; setLoading("ocr"); setError("");
    const imageDataUrls = await Promise.all(photos.map(renderPhoto));
    const response = await fetch("/api/issue-practice/personal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ocr", imageDataUrls }) });
    const data = await response.json(); setLoading(null); if (!response.ok) return setError(data.error || "文字辨識失敗");
    const parts = Array.isArray(data.parts) ? data.parts.map(String) : [];
    setPhotos((current) => current.map((photo, index) => ({ ...photo, dataUrl: imageDataUrls[index], sourceUrl: imageDataUrls[index], rotation: 0, crop: { left: 0, top: 0, right: 100, bottom: 100 }, ocrText: parts[index] || "" })));
    setOcrText(String(data.text || "")); if (!title) setTitle(String(data.text || "").replace(/\s+/gu, " ").slice(0, 32));
  }
  async function save() {
    if (ocrText.trim().length < 10 || loading) return; setLoading("save"); setError("");
    const response = await fetch("/api/issue-practice/personal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", imageDataUrls: photos.map((photo) => photo.dataUrl), ocrParts: photos.map((photo) => photo.ocrText), questionText: ocrText, title, subject, sourceLabel }) });
    const data = await response.json(); setLoading(null); if (!response.ok) return setError(data.error || "保存失敗");
    setActive(data.question); setOcrText(""); setPhotos([]); setStudentIssues(""); setResult(null); await refresh("");
  }
  async function openQuestion(id: number) {
    setLoading("load"); setError(""); const response = await fetch(`/api/issue-practice/personal?id=${id}`); const data = await response.json(); setLoading(null);
    if (!response.ok) return setError(data.error || "讀取失敗"); setActive(data.question); setStudentIssues(data.record?.studentIssues || ""); setResult(data.record?.aiResult || null); setPhotos([]); setOcrText("");
  }
  async function analyze() {
    if (!active || studentIssues.trim().length < 10 || loading) return; setLoading("analyze"); setError("");
    const response = await fetch("/api/issue-practice/personal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "analyze", personalQuestionId: active.id, studentIssues }) });
    const data = await response.json(); setLoading(null); if (!response.ok) return setError(data.error || "AI 分析失敗"); setResult(data); await refresh(keyword);
  }
  async function suggestIssues() {
    if (!active || loading) return; setLoading("suggest"); setError("");
    const response = await fetch("/api/issue-practice/personal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "suggest", personalQuestionId: active.id }) });
    const data = await response.json(); setLoading(null); if (!response.ok) return setError(data.error || "AI 爭點提示失敗"); setIssueSuggestion(String(data.suggestion || ""));
  }
  function addSuggestion() {
    if (!issueSuggestion.trim()) return;
    setStudentIssues((current) => current.trim() ? `${current.trim()}\n${issueSuggestion.trim()}` : issueSuggestion.trim());
    setIssueSuggestion("");
  }

  return <section className="personal-issue-practice" onPaste={(event) => { const files = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean) as File[]; if (files.length) { event.preventDefault(); files.slice(0, Math.max(0, 2 - photos.length)).forEach((file) => loadImage(new File([file], `貼上的題目-${Date.now()}.png`, { type: file.type }))); } }}>
    <div className="issue-source-tabs"><button type="button" onClick={onBack}>從歷屆題庫選題</button><button type="button" className="active">拍照／貼上截圖</button></div>
    {!active && <section className="personal-issue-capture"><header><div><span>MY PHOTO QUESTION</span><h3>把自己的書變成可複習題庫</h3></div><small>AI 只負責辨識；同學確認文字後才會保存</small></header>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { loadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      {!photos.length && <button type="button" className="personal-photo-drop" onClick={() => inputRef.current?.click()}><b>拍照或選擇第 1 張</b><span>每題最多 2 張；電腦也可直接按 Ctrl＋V 貼上圖片</span></button>}
      {!!photos.length && <><div className="personal-photo-sequence">{photos.map((photo, index) => <article key={photo.id}><header><b>第 {index + 1} 張{index === 0 ? "（先辨識）" : "（接續）"}</b><span>{photo.name}</span></header><img src={photo.dataUrl} alt={`題目第 ${index + 1} 張`} /><footer><button type="button" onClick={() => setEditingPhoto(index)}>旋轉／裁切</button>{photos.length === 2 && <button type="button" onClick={() => setPhotos((current) => [...current].reverse())}>交換順序</button>}<button type="button" onClick={() => { setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index)); setOcrText(""); }}>移除</button></footer></article>)}</div><div className="personal-photo-actions">{photos.length < 2 && <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>＋ 加入第 2 張</button>}<button type="button" className="personal-primary" onClick={() => void recognize()} disabled={Boolean(loading)}>{loading === "ocr" ? `AI 正在依序辨識 ${photos.length} 張…` : `依序辨識 ${photos.length} 張圖片`}</button></div></>}
      {ocrText && <section className="personal-ocr-confirm"><header><b>請同學確認辨識文字</b><span>可直接修正錯字；確認前不會存入題庫</span></header><textarea rows={12} value={ocrText} onChange={(event) => setOcrText(event.target.value)} /><div className="personal-question-meta"><label>科目<select value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label><label>書名／來源<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="例如：透明的刑法" /></label><label>題目名稱<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="方便日後搜尋" /></label></div><footer><span>{ocrText.trim().length} 字</span><button type="button" onClick={() => void save()} disabled={Boolean(loading) || ocrText.trim().length < 10}>{loading === "save" ? "保存中…" : "我已確認，存入我的題庫"}</button></footer></section>}
    </section>}
    {!active && <section className="personal-issue-library"><header><div><span>MY QUESTION LIBRARY</span><h3>我的拍照題庫</h3></div><span>{questions.length} 題</span></header><form onSubmit={(event) => { event.preventDefault(); void refresh(); }}><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜尋題目、人物、罪名或關鍵字" /><button>搜尋</button></form>{questions.length ? <div className="personal-question-list">{questions.map((question) => <button type="button" onClick={() => void openQuestion(question.id)} key={question.id}><span>{question.subject}｜{question.sourceLabel}</span><b>{question.title}</b><small>{question.preview}</small></button>)}</div> : <p>尚未保存拍照題目。拍下自己的書，確認文字後就會出現在這裡。</p>}</section>}
    {active && <><button type="button" className="personal-back" onClick={() => { setActive(null); setResult(null); setStudentIssues(""); setIssueSuggestion(""); }}>← 回我的拍照題庫</button><article className="student-issue-question personal-question"><header><div><span>{active.subject}</span><b>{active.title}</b></div><small>{active.sourceLabel}｜同學已確認文字</small></header>{(active.imageUrls?.length ? active.imageUrls : active.imageUrl ? [active.imageUrl] : []).length > 0 && <div className="personal-saved-images">{(active.imageUrls?.length ? active.imageUrls : [active.imageUrl!]).map((url, index) => <figure key={url}><img src={url} alt={`保存的題目原圖第 ${index + 1} 張`} /><figcaption>第 {index + 1} 張</figcaption></figure>)}</div>}<p>{active.questionText}</p></article><section className="student-issue-answer"><header><div><span>YOUR ISSUE LIST</span><h3>你認為本題有哪些爭點？</h3></div><small>本題沒有平台老師擬答，AI 將獨立分析</small></header><div className="personal-issue-hint-action"><div><b>不知道從哪裡開始？</b><span>AI 會依題目事實列出爭點提示，不會直接代寫完整解答。</span></div><button type="button" onClick={() => void suggestIssues()} disabled={Boolean(loading)}>{loading === "suggest" ? "AI 正在找爭點…" : issueSuggestion ? "重新請 AI 分析" : "請 AI 幫我找爭點"}</button></div>{issueSuggestion && <div className="personal-issue-suggestion"><header><b>AI 建議爭點</b><span>請先確認，再加入自己的爭點清單</span></header><div>{issueSuggestion.split("\n").filter(Boolean).map((line, index) => <p key={index}>{cleanAnalysisLine(line)}</p>)}</div><footer><button type="button" className="secondary" onClick={() => setIssueSuggestion("")}>先不用</button><button type="button" onClick={addSuggestion}>加入我的爭點</button></footer></div>}<textarea rows={10} value={studentIssues} onChange={(event) => setStudentIssues(event.target.value)} placeholder={'一、甲……是否成立……罪？\n二、乙……涉及何種法律問題？'} /><footer><span>{studentIssues.trim().length} 字</span><button type="button" onClick={() => void analyze()} disabled={Boolean(loading) || studentIssues.trim().length < 10}>{loading === "analyze" ? "AI 正在分析…" : result ? "重新分析並保存" : "送出 AI 獨立分析"}</button></footer></section></>}
    {result && <section className="student-issue-result"><header><div><span>AI INDEPENDENT ANALYSIS</span><h3>AI 獨立分析</h3></div><b>已保存，可日後重看</b></header><div className="personal-ai-warning">這不是老師標準答案；AI 只依同學確認後的題目文字與現行法分析。</div><div className="student-issue-analysis">{result.analysis.split("\n").map((line, index) => cleanAnalysisLine(line) ? <p className={/^[一二三四五六]、/.test(cleanAnalysisLine(line)) ? "heading" : ""} key={index}>{cleanAnalysisLine(line)}</p> : <br key={index} />)}</div><footer><div><b>{result.model}</b><span>{result.reason}</span><small>{result.modelId} · {(result.usage.inputTokens + result.usage.outputTokens).toLocaleString()} tokens · 約 NT$ {formatTwd(result.usage.estimatedCostUsd)}</small></div></footer></section>}
    {editingPhoto !== null && photos[editingPhoto] && <PhotoCropEditor photo={photos[editingPhoto]} index={editingPhoto} onCancel={() => setEditingPhoto(null)} onApply={(updated) => { setPhotos((current) => current.map((item, index) => index === editingPhoto ? updated : item)); setEditingPhoto(null); setOcrText(""); }} />}
    {error && <p className="student-issue-error">{error}</p>}
  </section>;
}

export function IssuePractice() {
  const [sourceMode, setSourceMode] = useState<"official" | "personal">("official");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionId, setQuestionId] = useState(0);
  const [subject, setSubject] = useState("全部");
  const [year, setYear] = useState("全部");
  const [studentIssues, setStudentIssues] = useState("");
  const [studentSupplement, setStudentSupplement] = useState("");
  const [sampleLevel, setSampleLevel] = useState<SampleLevel | null>(null);
  const [results, setResults] = useState<Partial<Record<"luna" | "sol", Result>>>({});
  const [activeResult, setActiveResult] = useState<"luna" | "sol">("luna");
  const [workflow, setWorkflow] = useState<Workflow>({});
  const [workflowLoading, setWorkflowLoading] = useState<"review" | "terra" | "sonnet" | "luna" | "sol" | null>(null);
  const [challengeText, setChallengeText] = useState("");
  const [historyIds, setHistoryIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState<"luna" | "sol" | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [savingSupplement, setSavingSupplement] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [sampleLoading, setSampleLoading] = useState<SampleLevel | null>(null);
  const [error, setError] = useState("");
  const [selectedLawText, setSelectedLawText] = useState("");
  const [detectedLawQuery, setDetectedLawQuery] = useState("");
  const [selectionToolPosition, setSelectionToolPosition] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const issuesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [lawLookup, setLawLookup] = useState<{ loading: boolean; article: LegalArticle | null; error: string; explanation: string; explaining: boolean } | null>(null);

  useEffect(() => {
    void fetch("/api/issue-practice").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "讀取失敗");
      setQuestions((data.questions || []).filter((item: Question) => supportsIssuePractice(item.subject)));
      setHistoryIds(new Set((data.history || []).map((item: { questionId: number }) => item.questionId)));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "題庫讀取失敗"));
  }, []);

  const subjects = useMemo(() => ["全部", ...new Set(questions.map((item) => item.subject).filter(Boolean))], [questions]);
  const years = useMemo(() => ["全部", ...new Set(questions.map((item) => item.year).filter(Boolean))], [questions]);
  const filtered = questions.filter((item) => (subject === "全部" || item.subject === subject) && (year === "全部" || item.year === year));
  const selected = questions.find((item) => item.id === questionId) ?? null;
  const result = results[activeResult] ?? results.luna ?? results.sol ?? null;
  const parsedAnalysis = result ? parseIssueAnalysis(result.analysis) : null;

  async function submit(model: "luna" | "sol") {
    if (!selected || studentIssues.trim().length < 10 || loading) return;
    setLoading(model); setError("");
    try {
      const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: selected.id, studentIssues, model, sampleLevel }) });
      const data = await response.json();
      if (!response.ok) return setError(data.error || "AI 比對失敗");
      setResults((current) => ({ ...current, [model]: data as Result })); setActiveResult(model);
      setHistoryIds((current) => new Set(current).add(selected.id)); setSavedNotice("本題練習與回答已保存");
    } catch {
      setError("連線中斷，答案仍保留在文字框內，請重新送出比對");
    } finally {
      setLoading(null);
    }
  }

  async function loadSample(level: SampleLevel) {
    if (!selected || sampleLoading) return;
    setSampleLoading(level); setError(""); setResults({});
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sample", questionId: selected.id, sampleLevel: level }) });
    const data = await response.json(); setSampleLoading(null);
    if (!response.ok) return setError(data.error || "測試擬答讀取失敗");
    setStudentIssues(String(data.text || "")); setSampleLevel(level); setStudentSupplement("");
    setSavedNotice(data.generator ? `高分樣本已由 ${data.generator.model} 獨立解題產生，成本與用量已記錄` : "");
    requestAnimationFrame(() => {
      if (!issuesTextareaRef.current) return;
      issuesTextareaRef.current.scrollTop = 0;
      issuesTextareaRef.current.scrollLeft = 0;
      issuesTextareaRef.current.setSelectionRange(0, 0);
    });
  }

  async function choose(value: number) {
    setQuestionId(value); setStudentIssues(""); setStudentSupplement(""); setSampleLevel(null); setResults({}); setWorkflow({}); setChallengeText(""); setActiveResult("luna"); setSavedNotice(""); setError("");
    if (!value) return;
    setRecordLoading(true);
    try {
      const response = await fetch(`/api/issue-practice?questionId=${value}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "紀錄讀取失敗");
      const record = data.record as SavedRecord | null;
      if (record) {
        setStudentIssues(record.studentIssues || ""); setStudentSupplement(record.studentSupplement || ""); setSampleLevel(record.sampleLevel ?? null);
        // Sol 已退出前台評分流程；舊紀錄保留於資料庫，但不再載入或觸發。
        setResults({ ...(record.lunaResult ? { luna: record.lunaResult } : {}) });
        setWorkflow(record.challengeWorkflow || {}); setChallengeText(record.challengeWorkflow?.challenge?.analysis || "");
        setActiveResult("luna"); setSavedNotice("已載入上次練習紀錄");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "紀錄讀取失敗"); }
    finally { setRecordLoading(false); }
  }

  async function runWorkflow(action: "sol-review-luna" | "challenge" | "reply", option?: "terra" | "sonnet" | "luna" | "sol") {
    if (!selected || workflowLoading) return;
    const key = action === "sol-review-luna" ? "review" : option || "terra"; setWorkflowLoading(key as typeof workflowLoading); setError("");
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, questionId: selected.id, studentIssues, challenger: action === "challenge" ? option : undefined, model: action === "reply" ? option : undefined, challengeText }) });
    const data = await response.json(); setWorkflowLoading(null);
    if (!response.ok) return setError(data.error || "本次檢核暫時無法完成");
    setWorkflow(data.workflow || {}); if (action === "challenge") setChallengeText(data.result?.analysis || ""); setSavedNotice("本題質疑與答辯歷程已保存");
  }

  function renderWorkflowResult(item?: WorkflowResult) { if (!item) return null; return <div className="issue-workflow-result"><div className="student-issue-analysis">{item.analysis.split("\n").map((line, index) => { const cleanLine = cleanAnalysisLine(line); return cleanLine ? <p className={/^[一二三四五六七八九十]、/.test(cleanLine) ? "heading" : ""} key={index}>{cleanLine}</p> : <br key={index} />; })}</div><small>{item.model} · {(item.usage.inputTokens + item.usage.outputTokens).toLocaleString()} tokens · NT$ {formatTwd(item.usage.estimatedCostUsd)}</small></div>; }

  function positionSelectionTool(range: Range) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const compact = window.innerWidth < 760;
    const halfWidth = compact ? Math.min(170, Math.max(120, window.innerWidth / 2 - 12)) : 205;
    const left = Math.min(window.innerWidth - halfWidth, Math.max(halfWidth, rect.left + rect.width / 2));
    const showAbove = rect.bottom + (compact ? 112 : 68) > window.innerHeight;
    setSelectionToolPosition({ left, top: showAbove ? Math.max(8, rect.top - 10) : rect.bottom + 10, placement: showAbove ? "above" : "below" });
  }

  useEffect(() => {
    if (!selectedLawText) return;
    const reposition = () => { if (selectedRangeRef.current) positionSelectionTool(selectedRangeRef.current); };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [selectedLawText]);

  function clearLawSelection() {
    setSelectedLawText(""); setDetectedLawQuery(""); setSelectionToolPosition(null); selectedRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function dismissSelectionTool() {
    setSelectionToolPosition(null); selectedRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function captureLawSelection() {
    // 已由 RootLayout 的全站智能框選工具統一處理，避免同頁出現兩套工具列。
    return;
  }

  async function lookupSelectedLaw() {
    if (!detectedLawQuery) return;
    const baseQuery = detectedLawQuery.replace(/第\d+項$/u, "");
    dismissSelectionTool();
    setLawLookup({ loading: true, article: null, error: "", explanation: "", explaining: false });
    const response = await fetch(`/api/legal-search?q=${encodeURIComponent(baseQuery)}&limit=5`);
    const data = await response.json();
    const article = (data.results?.find((item: LegalArticle & { matchType?: string }) => item.matchType === "exact") ?? data.results?.[0] ?? null) as LegalArticle | null;
    setLawLookup({ loading: false, article, error: response.ok && article ? "" : data.error || "已下載的全國法規資料庫查無這條法條。", explanation: "", explaining: false });
  }

  async function explainLaw() {
    if (!selectedLawText || lawLookup?.explaining) return;
    dismissSelectionTool();
    const current = lawLookup ?? { loading: false, article: null, error: "", explanation: "", explaining: false };
    setLawLookup({ ...current, explaining: true, error: "" });
    const response = await fetch("/api/legal-explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedText: selectedLawText, article: current.article }) });
    const data = await response.json();
    setLawLookup((latest) => latest ? { ...latest, article: latest.article ?? (response.ok ? { title: "框選內容", articleNo: "白話解釋", content: selectedLawText } : null), explaining: false, explanation: response.ok ? String(data.explanation || "") : "", error: response.ok ? "" : data.error || "白話解釋暫時無法完成。" } : latest);
  }

  async function saveSupplement() {
    if (!selected || savingSupplement) return;
    setSavingSupplement(true); setError("");
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-supplement", questionId: selected.id, studentIssues, studentSupplement, sampleLevel }) });
    const data = await response.json(); setSavingSupplement(false);
    if (!response.ok) return setError(data.error || "補充看法保存失敗");
    setHistoryIds((current) => new Set(current).add(selected.id)); setSavedNotice("補充看法已保存");
  }

  if (sourceMode === "personal") return <section className="student-issue-practice" aria-label="找爭點"><header className="student-issue-hero"><div><span>ISSUE SPOTTING PRACTICE</span><h2>找爭點</h2><p>拍下自己的書，確認 AI 辨識文字後保存，日後可搜尋、重寫與複習。</p></div><aside><b>我的</b><span>拍照題庫</span><small>原圖、確認文字與練習紀錄</small></aside></header><PersonalIssuePractice onBack={() => setSourceMode("official")} /></section>;

  return <section className="student-issue-practice" aria-label="找爭點">
    <header className="student-issue-hero"><div><span>ISSUE SPOTTING PRACTICE</span><h2>找爭點</h2><p>先自己找，再讓 AI 依同題老師擬答逐項比對。重點不是背答案，而是看見自己漏在哪一層。</p></div><aside><b>{questions.length}</b><span>題已核對擬答</span><small>只顯示可可靠比對的題目</small></aside></header>
    <div className="issue-source-tabs"><button type="button" className="active">從歷屆題庫選題</button><button type="button" onClick={() => setSourceMode("personal")}>拍照／貼上截圖</button></div>
    <div className="student-issue-steps"><span className={selected ? "done" : "active"}><b>1</b> 選真題</span><span className={selected && !result ? "active" : result ? "done" : ""}><b>2</b> 寫爭點</span><span className={result ? "active" : ""}><b>3</b> 看比對</span></div>
    <section className="student-issue-picker"><div><label>科目<select value={subject} onChange={(event) => { setSubject(event.target.value); void choose(0); }}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label><label>年度<select value={year} onChange={(event) => { setYear(event.target.value); void choose(0); }}>{years.map((item) => <option key={item}>{item}</option>)}</select></label></div><label>歷屆題目<select value={questionId} onChange={(event) => void choose(Number(event.target.value))}><option value={0}>{questions.length ? "請選擇一題" : "正在讀取題庫…"}</option>{filtered.map((item) => <option key={item.id} value={item.id}>{historyIds.has(item.id) ? "✓ 已練｜" : ""}{item.year}｜{item.subject}｜{item.examName || "司律二試"}第 {item.questionNumber} 題｜{questionSummary(item.stem)}</option>)}</select></label>{recordLoading && <small className="issue-record-status">正在載入這題的練習紀錄…</small>}</section>
    {selected ? <><article className="student-issue-question"><header><div><span>{selected.subject}</span><b>{selected.year}｜{selected.examName || "司律二試"}第 {selected.questionNumber} 題</b></div><small>本題已連結：{selected.answerSource || "老師參考擬答"}</small></header><p>{selected.stem}</p></article><section className="student-issue-answer"><header><div><span>YOUR ISSUE LIST</span><h3>你認為本題有哪些爭點？</h3></div><small>可依「行為人 → 行為 → 罪名／法律問題」逐行列出</small></header><div className="issue-sample-tools"><div><b>助教辨識力測試</b><span>帶入三種程度的測試擬答，檢查 Luna 是否正確判級與指出缺漏。</span></div><div>{([["basic","基礎擬答","明顯缺漏"],["intermediate","中等擬答","大致命中"],["advanced","高分擬答","完整有層次"]] as const).map(([level,label,note]) => <button type="button" className={sampleLevel === level ? "active" : ""} disabled={Boolean(sampleLoading)} onClick={() => void loadSample(level)} key={level}><b>{sampleLoading === level ? "載入中…" : label}</b><small>{note}</small></button>)}</div></div><textarea ref={issuesTextareaRef} rows={10} value={studentIssues} onChange={(event) => { setStudentIssues(event.target.value); setSavedNotice(""); if (sampleLevel) setSampleLevel(null); }} placeholder={'例如：\n一、甲……是否成立……罪？\n二、乙……涉及何種總則爭點？\n三、甲、乙間是否成立共同正犯？'} /><footer><span>{studentIssues.trim().length} 字{sampleLevel ? ` · 測試樣本：${sampleLevel === "basic" ? "基礎" : sampleLevel === "intermediate" ? "中等" : "高分"}` : ""}</span><button type="button" onClick={() => void submit("luna")} disabled={Boolean(loading) || studentIssues.trim().length < 10}>{loading ? "AI 正在逐項比對…" : results.luna ? "重新請 Luna 助教比對" : "送出給 Luna 助教比對"}</button></footer></section></> : <div className="student-issue-empty"><b>先選一題開始</b><span>題目不會立即顯示答案；請先完成自己的爭點清單。</span></div>}
    {error && <p className="student-issue-error">{error}</p>}
    {result && !lawLookup && selectedLawText && selectionToolPosition && <div className={`smart-selection-bar ${selectionToolPosition.placement}`} style={{ left: selectionToolPosition.left, top: selectionToolPosition.top }}><span>已框選：{selectedLawText}</span><button type="button" onClick={() => void lookupSelectedLaw()} disabled={!detectedLawQuery} title={detectedLawQuery ? `搜尋 ${detectedLawQuery}` : "框選內容未辨識出法規名稱與條號"}>法條搜尋</button><button type="button" onClick={() => void explainLaw()}>白話解釋</button><button type="button" aria-label="關閉框選工具" onClick={clearLawSelection}>×</button></div>}
    {result && <section className="student-issue-result" onMouseUp={captureLawSelection} onTouchEnd={captureLawSelection}><header><div><span>AI COMPARISON</span><h3>AI 逐項分析</h3></div><b>{savedNotice || "已完成並保存"}</b></header>{selectedLawText && <div className="law-selection-bar"><span>已框選：{selectedLawText}</span><button type="button" onClick={() => void lookupSelectedLaw()}>查法條</button><button type="button" aria-label="關閉法條選取" onClick={() => setSelectedLawText("")}>×</button></div>}<div className="issue-result-tabs" role="tablist" aria-label="切換 Luna 與 Sol 回答"><button type="button" role="tab" aria-selected={activeResult === "luna"} className={activeResult === "luna" ? "active" : ""} disabled={!results.luna} onClick={() => setActiveResult("luna")}>Luna 評論同學{results.luna ? "｜已完成" : "｜尚未回答"}</button><button type="button" role="tab" aria-selected={activeResult === "sol"} className={activeResult === "sol" ? "active" : ""} disabled={!results.sol} onClick={() => setActiveResult("sol")}>Sol 評論同學{results.sol ? "｜已完成" : "｜尚未回答"}</button></div>{result.sampleLabel && <div className="issue-sample-verdict"><span>測試預期</span><b>{result.sampleLabel}</b><small>請核對下方「程度判定」是否一致；不一致代表助教分級仍需調整。</small></div>}{parsedAnalysis?.score && parsedAnalysis.level && <div className="issue-analysis-summary"><span>爭點辨識完成度：<strong>{parsedAnalysis.score}分</strong></span><span>程度判定：<b className={`level-${parsedAnalysis.level === "基礎" ? "basic" : parsedAnalysis.level === "中等" ? "intermediate" : "advanced"}`}>{parsedAnalysis.level}</b></span></div>}<div className="student-issue-analysis">{(parsedAnalysis?.lines ?? result.analysis.split("\n")).map((line, index) => { const cleanLine = cleanAnalysisLine(line); return cleanLine ? <p className={/^[一二三四五六]、/.test(cleanLine) ? "heading" : ""} key={index}>{cleanLine}</p> : <br key={index} />; })}</div><footer><div><b>此次對話使用 {result.model}</b><span>原因：{result.reason}</span><small>{result.modelId} · {(result.usage.inputTokens + result.usage.outputTokens).toLocaleString()} tokens · {result.usage.cachedTokens.toLocaleString()} cached · {(result.usage.durationMs / 1000).toFixed(1)} 秒 · 約 US$ {result.usage.estimatedCostUsd.toFixed(5)}／NT$ {formatTwd(result.usage.estimatedCostUsd)}</small></div>{!results.sol && <button type="button" onClick={() => void submit("sol")} disabled={Boolean(loading)}>{loading === "sol" ? "Sol 分析中…" : "請 Sol 評論同學"}</button>}{!results.luna && <button type="button" onClick={() => void submit("luna")} disabled={Boolean(loading)}>{loading === "luna" ? "Luna 分析中…" : "請 Luna 助教分析"}</button>}</footer>{results.luna && results.sol && <section className="issue-challenge-flow"><header><span>MODEL CHALLENGE</span><h4>覆核、質疑與答辯</h4><p>兩份評論完成後，才進入這一區；所有模型都會重新讀取完整老師擬答。</p></header><div className="issue-flow-step"><b>1　Sol 獨立覆核 Luna</b><button type="button" onClick={() => void runWorkflow("sol-review-luna")} disabled={Boolean(workflowLoading)}>{workflowLoading === "review" ? "覆核中…" : workflow.solReview ? "重新覆核 Luna" : "請 Sol 覆核 Luna"}</button>{renderWorkflowResult(workflow.solReview)}</div><div className="issue-flow-step"><b>2　選擇擬答質疑者</b><p>只針對模型回答與老師擬答的實質差異提出質疑；沒有錯誤時不得硬問。</p><div className="issue-challenger-buttons"><button type="button" onClick={() => void runWorkflow("challenge", "terra")} disabled={Boolean(workflowLoading)}>{workflowLoading === "terra" ? "Terra 檢核中…" : "Terra 質疑者｜理性檢核"}</button><button type="button" onClick={() => void runWorkflow("challenge", "sonnet")} disabled={Boolean(workflowLoading)}>{workflowLoading === "sonnet" ? "Sonnet 檢核中…" : "Sonnet 質疑者｜教學式追問"}</button></div>{workflow.challenge && <><textarea rows={8} value={challengeText} onChange={(event) => setChallengeText(event.target.value)} aria-label="可修改的質疑內容" /><small className="issue-challenge-meta">{workflow.challenge.model} · {(workflow.challenge.usage.inputTokens + workflow.challenge.usage.outputTokens).toLocaleString()} tokens · NT$ {formatTwd(workflow.challenge.usage.estimatedCostUsd)}</small></>}</div>{workflow.challenge && <div className="issue-flow-step"><b>3　指定誰回應質疑並提出修正版</b><div className="issue-challenger-buttons"><button type="button" onClick={() => void runWorkflow("reply", "luna")} disabled={Boolean(workflowLoading) || challengeText.trim().length < 10}>{workflowLoading === "luna" ? "Luna 回應中…" : "請 Luna 回應並修正"}</button><button type="button" onClick={() => void runWorkflow("reply", "sol")} disabled={Boolean(workflowLoading) || challengeText.trim().length < 10}>{workflowLoading === "sol" ? "Sol 回應中…" : "請 Sol 回應並修正"}</button></div>{workflow.lunaReply && <details open><summary>Luna 的答辯與修正版</summary>{renderWorkflowResult(workflow.lunaReply)}</details>}{workflow.solReply && <details open><summary>Sol 的答辯與修正版</summary>{renderWorkflowResult(workflow.solReply)}</details>}</div>}</section>}<section className="issue-student-supplement"><header><div><span>MY FOLLOW-UP</span><h4>補充我的看法</h4></div><small>可記下不同見解、漏掉的爭點或看完兩份回答後的修正。</small></header><textarea rows={5} value={studentSupplement} onChange={(event) => { setStudentSupplement(event.target.value); setSavedNotice(""); }} placeholder="例如：我認為此處仍應區分……；老師擬答採……，但若採另一說……" /><footer><span>{studentSupplement.trim().length} 字</span><button type="button" onClick={() => void saveSupplement()} disabled={savingSupplement}>{savingSupplement ? "保存中…" : "保存補充看法"}</button></footer></section></section>}
    {lawLookup && <div className="law-lookup-backdrop" role="presentation" onMouseDown={() => setLawLookup(null)}><aside className="law-lookup-panel" role="dialog" aria-modal="true" aria-label="法條查詢結果" onMouseDown={(event) => event.stopPropagation()}><header><div><span>全國法規資料庫｜已下載資料</span><h3>{selectedLawText || "法條查詢"}</h3></div><button type="button" onClick={() => setLawLookup(null)} aria-label="關閉">×</button></header>{lawLookup.loading ? <p className="law-lookup-status">正在查詢已下載的法規資料…</p> : lawLookup.article ? <><section><small>{lawLookup.article.title}{lawLookup.article.hierarchy ? `｜${lawLookup.article.hierarchy}` : ""}</small><h4>{lawLookup.article.articleNo}</h4><p>{lawLookup.article.content}</p>{lawLookup.article.modifiedDate && <time>資料異動日期：{lawLookup.article.modifiedDate}</time>}</section><footer><button type="button" onClick={() => void explainLaw()} disabled={lawLookup.explaining}>{lawLookup.explaining ? "正在解釋…" : "白話解釋"}</button>{lawLookup.article.sourceUrl && <a href={lawLookup.article.sourceUrl} target="_blank" rel="noreferrer">查看官方來源 ↗</a>}</footer>{lawLookup.explanation && <section className="law-plain-explanation"><b>白話解釋</b><p>{lawLookup.explanation}</p><small>解釋以目前顯示的完整條文為依據，不取代老師解析。</small></section>}</> : <p className="law-lookup-status error">{lawLookup.error}</p>}{lawLookup.error && lawLookup.article && <p className="law-lookup-status error">{lawLookup.error}</p>}</aside></div>}
  </section>;
}
