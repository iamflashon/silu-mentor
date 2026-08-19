"use client";

import { useEffect, useState } from "react";

type Conflict = { teacherAnswer: string; aiAnswer: string; recommendation: "teacher" | "ai" | "ambiguous"; reason: string };
type EvidenceAttachment = { id: string; name: string; contentType: string; sizeBytes: number; url: string };
type ExternalReview = {
  questionFound: "yes" | "no" | "unclear";
  answerAssessment: "teacher" | "ai" | "ambiguous" | "insufficient";
  answerReason: string;
  leakageRisk: "none_found" | "possible" | "high_similarity" | "insufficient";
  leakageReason: string;
  searchSummary: string;
  candidateSources: Array<{ title: string; url: string; sourceType: string; relationship: string; excerpt: string }>;
  matchedPhrases: string[];
  limitations: string;
  manualEvidence?: string;
  attachments?: EvidenceAttachment[];
  citations: Array<{ title: string; url: string }>;
  searchedAt: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearchCalls: number; estimatedCostUsdMicros: number };
};

type PendingImage = { file: File; previewUrl: string };

function EvidenceText({ value }: { value: string }) {
  const parts = String(value || "").split(/(https?:\/\/[^\s<>()\[\]"']+)/giu);
  return <>{parts.map((part, index) => /^https?:\/\//iu.test(part) ? <a key={index} href={part.replace(/[.,;，。；、]+$/u, "")} target="_blank" rel="noreferrer">{part}</a> : <span key={index}>{part}</span>)}</>;
}

function formatExternalCost(micros: number) {
  const usd = Math.max(0, Number(micros || 0)) / 1_000_000;
  return `US$ ${usd.toFixed(5)} · 約 NT$ ${(usd * 32.5).toFixed(3)}`;
}

function externalLabel(value: ExternalReview["questionFound"]) {
  return value === "yes" ? "找到公開相同／近似題目" : value === "no" ? "目前未找到明確相同題目" : "尚不足以判定是否存在外部題目";
}

function leakageLabel(value: ExternalReview["leakageRisk"]) {
  return value === "high_similarity" ? "高度相似，需人工確認" : value === "possible" ? "可能相似，需人工確認" : value === "none_found" ? "目前未發現明確相似證據" : "資料不足，不能判定";
}

function readableEvidenceText(value: string) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, "$1")
    .replace(/https?:\/\/[^\s<>()\[\]"']+/giu, (raw) => {
      try { return new URL(raw.replace(/[.,;，。；、)]+$/u, "")).hostname; } catch { return "外部來源"; }
    });
}

function sourceDisplayName(title: string, url: string) {
  const cleanTitle = readableEvidenceText(title).trim();
  if (cleanTitle && !/^https?:\/\//iu.test(cleanTitle)) return cleanTitle;
  try { return new URL(url).hostname; } catch { return "外部搜尋來源"; }
}

export function AnswerConflictPanel({ questionId, questionNumber, teacherAnswer, aiAnswer, note, onUpdated }: { questionId: number; questionNumber: string; teacherAnswer?: string; aiAnswer?: string; note?: string; onUpdated?: (item: Record<string, unknown>) => void }) {
  const teacher = String(teacherAnswer || "").trim().toUpperCase();
  const ai = String(aiAnswer || "").trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Conflict | null>(null);
  const [message, setMessage] = useState("");
  const [externalReview, setExternalReview] = useState<ExternalReview | null>(null);
  const [externalSaved, setExternalSaved] = useState(false);
  const [manualEvidence, setManualEvidence] = useState("");
  const [savedAttachments, setSavedAttachments] = useState<EvidenceAttachment[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const different = /^[A-D]$/.test(teacher) && /^[A-D]$/.test(ai) && teacher !== ai;

  function addEvidenceFiles(incoming: File[]) {
    const images = incoming.filter((file) => file.type.startsWith("image/") && file.size > 0 && file.size <= 8 * 1024 * 1024);
    const rejected = incoming.length - images.length;
    const room = Math.max(0, 12 - savedAttachments.length - pendingImages.length);
    const selected = images.slice(0, room);
    if (rejected || selected.length < images.length) setMessage("圖片證據需為圖片檔、每張不超過 8MB，且同一題最多 12 張。未符合的檔案已略過。");
    setPendingImages((current) => [...current, ...selected.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removePendingImage(index: number) {
    setPendingImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function removeSavedAttachment(id: string) {
    setSavedAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setExternalReview((current) => current ? { ...current, attachments: (current.attachments || []).filter((attachment) => attachment.id !== id) } : current);
    setMessage("已移除這張圖片；請按保存人工查核資料後正式更新。");
  }

  function pasteEvidence(event: { clipboardData: DataTransfer; preventDefault: () => void }) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    addEvidenceFiles(files);
  }

  async function loadExternalReview() {
    try {
      const response = await fetch(`/api/medtech/admin/questions/simulation/external-review?questionId=${questionId}`, { cache: "no-store" });
      const data = await response.json() as { review?: ExternalReview | null };
      if (response.ok && data.review) {
        setExternalReview(data.review);
        setExternalSaved(true);
        setManualEvidence(data.review.manualEvidence || "");
        setSavedAttachments(data.review.attachments || []);
      } else {
        setExternalReview(null);
        setExternalSaved(false);
        setManualEvidence("");
        setSavedAttachments([]);
      }
    } catch {
      setExternalReview(null);
      setExternalSaved(false);
      setManualEvidence("");
      setSavedAttachments([]);
    }
  }

  async function externalInvestigate() {
    setBusy(true);
    setMessage("正在啟動外部搜尋，查找公開同題、答案與相似文字…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation/external-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: questionId, mode: "web" }) });
      const data = await response.json() as { review?: ExternalReview; error?: string };
      if (!response.ok || !data.review) { setMessage(data.error || "外部證據查核失敗，請稍後再試。"); return; }
      setExternalReview(data.review);
      setExternalSaved(false);
      setMessage("外部查核完成；請按「儲存查核結果」保留本次證據。搜尋來源不會自動認定抄襲，也不會自動改答案。");
    } catch {
      setMessage("外部證據查核失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function saveManualEvidence() {
    if (manualEvidence.trim().length < 10 && pendingImages.length === 0 && savedAttachments.length === 0) { setMessage("請先貼上查核文字，或新增至少一張圖片證據。"); return; }
    setBusy(true);
    setMessage("正在保存人工查核資料…");
    try {
      const form = new FormData();
      form.append("id", String(questionId));
      form.append("mode", "manual");
      form.append("evidenceText", manualEvidence);
      form.append("keepAttachmentIds", JSON.stringify(savedAttachments.map((attachment) => attachment.id)));
      for (const image of pendingImages) form.append("attachments", image.file, image.file.name);
      const response = await fetch("/api/medtech/admin/questions/simulation/external-review", { method: "POST", body: form });
      const data = await response.json() as { review?: ExternalReview; error?: string };
      if (!response.ok || !data.review) { setMessage(data.error || "人工查核資料保存失敗。"); return; }
      setExternalReview(data.review);
      setExternalSaved(true);
      setSavedAttachments(data.review.attachments || []);
      for (const image of pendingImages) URL.revokeObjectURL(image.previewUrl);
      setPendingImages([]);
      setMessage("已保存人工查核資料與圖片證據；本次未使用 AI，也沒有外部搜尋費用。");
    } catch {
      setMessage("人工查核資料保存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function saveExternalReview() {
    if (!externalReview || externalSaved) return;
    setBusy(true);
    setMessage("正在保存外部查核結果…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation/external-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: questionId, mode: "save", review: externalReview }) });
      const data = await response.json() as { review?: ExternalReview; error?: string };
      if (!response.ok || !data.review) { setMessage(data.error || "外部查核結果保存失敗。"); return; }
      setExternalReview(data.review);
      setExternalSaved(true);
      setMessage("外部查核結果已儲存，之後重新進入本題仍可查看。");
    } catch {
      setMessage("外部查核結果保存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

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

  useEffect(() => {
    // 這裡是切換題目後同步讀取外部查核紀錄，非由 effect 推導本地狀態。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExternalReview(null);
    setExternalSaved(false);
    setManualEvidence("");
    setSavedAttachments([]);
    setPendingImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.previewUrl);
      return [];
    });
    void loadExternalReview();
    // 只在切換題目時讀取最近一次外部查核紀錄。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  if (!different && !report) return null;

  return <section className="answer-conflict-panel" aria-live="polite">
    <div className="answer-conflict-head"><div><b>答案差異警告</b><small>第 {questionNumber || questionId} 題：老師答案 {teacher}，AI 答案 {ai}。系統不會自動覆蓋老師答案。</small></div><div className="answer-conflict-head-actions"><button type="button" disabled={busy} onClick={() => void investigate()}>{busy ? "處理中…" : report ? "重新 AI 覆核" : "AI 重新覆核"}</button><button type="button" className="external-evidence-button" disabled={busy} onClick={() => void externalInvestigate()}>{busy ? "查核中…" : externalReview?.usage.webSearchCalls ? "重新外部查核" : "外部搜尋證據／查重"}</button></div></div>
    {note && !report && <p className="answer-conflict-note">上次調查紀錄：{note}</p>}
    {report && <div className="answer-conflict-report"><p><b>AI 調查結論：</b>{report.recommendation === "teacher" ? "暫維持老師答案，建議優先檢查 AI 是否套用錯誤原理。" : report.recommendation === "ai" ? "建議老師重新檢查教材答案，AI 答案可能較合理。" : "題目或答案可能有歧義，建議人工查核原始教材。"}</p><p>{report.reason}</p><div className="answer-conflict-decisions"><button type="button" disabled={busy} onClick={() => void decide("keep_teacher")}>維持老師答案 {teacher}</button><button type="button" disabled={busy} onClick={() => void decide("use_ai")}>改採 AI 答案 {ai}</button><button type="button" className="secondary" disabled={busy} onClick={() => void decide("pending")}>暫不決定</button></div></div>}
    {externalReview && <div className="external-evidence-report"><div className="external-evidence-title"><div><b>外部證據查核</b><small>{externalReview.model === "manual" ? "人工貼上資料" : "已啟動 web_search"} · {new Date(externalReview.searchedAt).toLocaleString("zh-TW", { hour12: false })}</small></div><div className="external-evidence-title-actions"><span className={externalReview.leakageRisk === "high_similarity" ? "high" : externalReview.leakageRisk === "possible" ? "possible" : "normal"}>{leakageLabel(externalReview.leakageRisk)}</span>{externalReview.model !== "manual" && <button type="button" className="external-evidence-save" disabled={busy || externalSaved} onClick={() => void saveExternalReview()}>{externalSaved ? "已儲存查核結果" : "儲存查核結果"}</button>}</div></div><p><b>外部題目：</b>{externalLabel(externalReview.questionFound)}</p><p><b>答案覆核：</b>{externalReview.answerAssessment === "teacher" ? "外部證據較支持老師答案" : externalReview.answerAssessment === "ai" ? "外部證據較支持 AI 答案" : externalReview.answerAssessment === "ambiguous" ? "外部資料仍有歧義" : "外部資料不足以判定"}。{readableEvidenceText(externalReview.answerReason)}</p><p><b>相似／外洩判斷：</b>{readableEvidenceText(externalReview.leakageReason)}</p><p>{readableEvidenceText(externalReview.searchSummary)}</p>{externalReview.matchedPhrases.length > 0 && <p><b>命中相似片段：</b>{externalReview.matchedPhrases.map(readableEvidenceText).join("；")}</p>}{externalReview.manualEvidence && <details open><summary>人工貼上的查核資料</summary><div className="manual-evidence-content"><EvidenceText value={externalReview.manualEvidence} /></div></details>}{externalReview.candidateSources.length > 0 && <div className="external-evidence-sources"><b>可追溯來源</b>{externalReview.candidateSources.map((source) => <article key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{sourceDisplayName(source.title, source.url)}</a><small>{source.relationship} · {source.sourceType}</small>{source.excerpt && <p>{readableEvidenceText(source.excerpt)}</p>}</article>)}</div>}{externalReview.citations.length > 0 && externalReview.candidateSources.length === 0 && <div className="external-evidence-sources"><b>本次搜尋實際引用來源</b>{externalReview.citations.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{sourceDisplayName(source.title, source.url)}</a>)}</div>}<small className="external-evidence-cost">本次成本：{externalReview.usage.inputTokens.toLocaleString()} input tokens · {externalReview.usage.outputTokens.toLocaleString()} output tokens · 外部搜尋 {externalReview.usage.webSearchCalls} 次 · {formatExternalCost(externalReview.usage.estimatedCostUsdMicros)}</small><small className="external-evidence-limit">{readableEvidenceText(externalReview.limitations)}</small></div>}
    <div className="manual-evidence-box"><div><b>免費人工查核</b><small>可貼上外部搜尋結果、網址與多張官方／老師截圖；Ctrl／Cmd＋V 可直接貼上截圖，網址會自動變成超連結。保存時不呼叫 AI、不啟動外部搜尋，成本為 0。</small></div><label className="manual-evidence-upload">上傳圖片證據（可多選）<input type="file" accept="image/*" multiple disabled={busy || savedAttachments.length + pendingImages.length >= 12} onChange={(event) => { addEvidenceFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label><textarea value={manualEvidence} onChange={(event) => setManualEvidence(event.target.value)} onPaste={pasteEvidence} placeholder="貼上外部搜尋結果、網址、題目相似片段或老師查核備註…也可以直接 Ctrl／Cmd＋V 貼上截圖。" rows={4} disabled={busy} />{(savedAttachments.length > 0 || pendingImages.length > 0) && <div className="manual-evidence-attachments"><b>圖片證據（{savedAttachments.length + pendingImages.length}/12）</b><div>{savedAttachments.map((attachment) => <figure key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt={attachment.name} /></a><figcaption><span>{attachment.name}</span><button type="button" disabled={busy} onClick={() => removeSavedAttachment(attachment.id)} aria-label={`移除${attachment.name}`}>×</button></figcaption></figure>)}{pendingImages.map((image, index) => <figure key={`${image.file.name}-${index}`}><img src={image.previewUrl} alt={image.file.name} /><figcaption><span>{image.file.name}</span><button type="button" disabled={busy} onClick={() => removePendingImage(index)} aria-label={`移除${image.file.name}`}>×</button></figcaption></figure>)}</div></div>}<button type="button" className="secondary" disabled={busy || (!manualEvidence.trim() && pendingImages.length === 0 && savedAttachments.length === 0)} onClick={() => void saveManualEvidence()}>保存人工查核資料（免費）</button></div>
    {message && <small className="answer-conflict-message">{message}</small>}
  </section>;
}
