"use client";

import { useEffect, useRef, useState } from "react";
import { AnswerConflictPanel } from "./AnswerConflictPanel";

type Cue = { id: number; startSeconds: number; endSeconds: number; text: string; sequence: number };
type Media = { solutionId: number; audioFileName: string | null; audioUrl: string; cues: Cue[] };
type OrderedQuestion = { id: number; questionNumber: string; sourceOrder: number | null; reviewStatus?: "pending" | "confirmed"; status?: string; year?: string; subject?: string; stem?: string; options?: Record<string, string>; explanation?: string; aiCompleteExplanation?: string; teacherCompleteExplanation?: string; completeExplanation?: string; simulatedExplanation?: string; simulatedCompleteExplanation?: string; answerSource?: string; teacherAnswer?: string; correctAnswer?: string | null; simulatedAnswer?: string; simulatedTeacherNote?: string };

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function QuestionMediaPanel({ questionId, questionNumber, allowDelete = true }: { questionId: number; questionNumber: string; allowDelete?: boolean }) {
  const [media, setMedia] = useState<Media | null>(null);
  const [sourceOrder, setSourceOrder] = useState<number | "">("");
  const [previousQuestion, setPreviousQuestion] = useState<OrderedQuestion | null>(null);
  const [nextQuestion, setNextQuestion] = useState<OrderedQuestion | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"pending" | "confirmed">("pending");
  const [questionStatus, setQuestionStatus] = useState("draft");
  const [teacherAnswer, setTeacherAnswer] = useState("");
  const [simulatedAnswer, setSimulatedAnswer] = useState("");
  const [simulatedTeacherNote, setSimulatedTeacherNote] = useState("");
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const audioInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const repairedDocumentId = useRef<number | null>(null);
  async function load() {
    const response = await fetch(`/api/medtech/admin/question-media?questionId=${questionId}`, { cache: "no-store" });
    const data = await response.json() as { media?: Media | null; error?: string };
    if (response.ok) setMedia(data.media ?? null);
    else setNotice(data.error ?? "語音資料讀取失敗");
  }

  async function loadOrder() {
    const response = await fetch(`/api/medtech/admin/questions?id=${questionId}`, { cache: "no-store" });
    const data = await response.json() as { item?: OrderedQuestion & { sourceUrl?: string }; error?: string };
    if (!response.ok || !data.item) return;
    let item = data.item;
    setReviewStatus(item.reviewStatus === "confirmed" ? "confirmed" : "pending");
    setQuestionStatus(item.status ?? "draft");
    setTeacherAnswer(String(item.teacherAnswer || item.correctAnswer || "").trim().toUpperCase());
    setSimulatedAnswer(String(item.simulatedAnswer || "").trim().toUpperCase());
    setSimulatedTeacherNote(String(item.simulatedTeacherNote || "").trim());
    const documentId = Number(String(item.sourceUrl ?? "").replace(/^document:/, ""));
    if (!Number.isInteger(documentId) || documentId < 1) return;
    if (repairedDocumentId.current !== documentId) {
      repairedDocumentId.current = documentId;
      const repairResponse = await fetch("/api/medtech/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repairSourceOrder: true, sourceUrl: item.sourceUrl }),
      });
      const repairData = await repairResponse.json() as { repaired?: number };
      if (repairResponse.ok && Number(repairData.repaired ?? 0) > 0) {
        window.location.reload();
        return;
      }
      const refreshed = await fetch(`/api/medtech/admin/questions?id=${questionId}`, { cache: "no-store" });
      const refreshedData = await refreshed.json() as { item?: OrderedQuestion & { sourceUrl?: string } };
      if (refreshedData.item) item = refreshedData.item;
    }
    setSourceOrder(item.sourceOrder ?? "");
    const firstResponse = await fetch(`/api/medtech/admin/questions?documentId=${documentId}&limit=100&page=1&order=source`, { cache: "no-store" });
    const firstData = await firstResponse.json() as { items?: OrderedQuestion[]; total?: number };
    const items = [...(firstData.items ?? [])];
    const pages = Math.ceil((firstData.total ?? items.length) / 100);
    for (let page = 2; page <= pages; page += 1) {
      const pageResponse = await fetch(`/api/medtech/admin/questions?documentId=${documentId}&limit=100&page=${page}&order=source`, { cache: "no-store" });
      const pageData = await pageResponse.json() as { items?: OrderedQuestion[] };
      items.push(...(pageData.items ?? []));
    }
    const compare = (left: OrderedQuestion, right: OrderedQuestion) => {
      const leftOrder = Number(left.sourceOrder ?? 0);
      const rightOrder = Number(right.sourceOrder ?? 0);
      if (leftOrder > 0 && rightOrder > 0) return leftOrder - rightOrder || left.id - right.id;
      if (leftOrder > 0) return -1;
      if (rightOrder > 0) return 1;
      return left.id - right.id;
    };
    items.sort(compare);
    const index = items.findIndex((item) => item.id === questionId);
    setPreviousQuestion(index > 0 ? items[index - 1] : null);
    setNextQuestion(index >= 0 && index < items.length - 1 ? items[index + 1] : null);
  }

  useEffect(() => {
    setMedia(null);
    setActiveCue(null);
    setReviewStatus("pending");
    setQuestionStatus("draft");
    setTeacherAnswer("");
    setSimulatedAnswer("");
    setSimulatedTeacherNote("");
    setNotice("");
    void load();
    void loadOrder();
  }, [questionId]);

  useEffect(() => {
    const handleBulkReview = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: number[]; unanswered?: number }>).detail;
      if (!detail?.ids?.includes(questionId)) return;
      setReviewStatus("confirmed");
      setNotice(detail.unanswered
        ? `本題已批次校對完成；目前仍有 ${detail.unanswered} 題沒有 A～D 老師答案。`
        : "本題已批次校對完成；目前可測試發布。");
    };
    window.addEventListener("medtech-bulk-review-updated", handleBulkReview);
    return () => window.removeEventListener("medtech-bulk-review-updated", handleBulkReview);
  }, [questionId]);

  async function saveOrder() {
    setOrderBusy(true);
    setNotice("正在儲存原稿順序…");
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: questionId, sourceOrder: sourceOrder === "" ? null : Number(sourceOrder) }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setNotice(data.error ?? "原稿順序儲存失敗"); return; }
      window.location.reload();
    } catch {
      setNotice("原稿順序儲存失敗，請稍後再試。");
    } finally {
      setOrderBusy(false);
    }
  }

  async function updateReview(action: "confirmReview" | "cancelReview") {
    if (action === "confirmReview" && !window.confirm(`確定第 ${questionNumber || questionId} 題的答案與解析都已經校對完成嗎？`)) return;
    setOrderBusy(true);
    setNotice(action === "confirmReview" ? "正在確認校對狀態…" : "正在取消校對並關閉公開內容…");
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: questionId, [action]: true }),
      });
      const data = await response.json() as { item?: { reviewStatus?: "pending" | "confirmed"; status?: string }; error?: string; unpublished?: boolean };
      if (!response.ok) { setNotice(data.error ?? "校對狀態更新失敗"); return; }
      const nextReviewStatus = action === "confirmReview" ? "confirmed" : "pending";
      setReviewStatus(nextReviewStatus);
      setQuestionStatus(data.item?.status ?? (action === "cancelReview" && data.unpublished ? "disabled" : questionStatus));
      window.dispatchEvent(new CustomEvent("medtech-question-review-updated", { detail: { id: questionId, item: data.item } }));
      setNotice(action === "confirmReview" ? "本題已確認校對完成；現在可以發布。" : data.unpublished && /^[A-D]$/.test(teacherAnswer) ? "本題已取消完整校對並下架；因老師答案仍已確認，可直接重新發布。" : data.unpublished ? "本題已取消校對並下架；重新校對後才能發布。" : "本題已取消校對，需重新確認後才能發布。");
    } catch {
      setNotice("校對狀態更新失敗，請稍後再試。");
    } finally {
      setOrderBusy(false);
    }
  }

  async function swapQuestion(target: OrderedQuestion | null, direction: "up" | "down") {
    if (!target) return;
    const currentOrder = Number(sourceOrder);
    const targetOrder = Number(target.sourceOrder);
    if (!Number.isInteger(currentOrder) || currentOrder < 1 || !Number.isInteger(targetOrder) || targetOrder < 1) {
      setNotice("這兩題都需要先有原稿順序，才能對調。");
      return;
    }
    if (!window.confirm(`確定將第 ${questionNumber || questionId} 題與第 ${target.questionNumber || target.id} 題對調原稿順序嗎？`)) return;
    const currentNextOrder = currentOrder === targetOrder
      ? direction === "up" ? currentOrder : currentOrder + 1
      : targetOrder;
    const targetNextOrder = currentOrder === targetOrder
      ? direction === "up" ? targetOrder + 1 : targetOrder
      : currentOrder;
    setOrderBusy(true);
    setNotice("正在對調原稿順序…");
    try {
      const responses = await Promise.all([
        fetch("/api/medtech/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: questionId, sourceOrder: currentNextOrder }) }),
        fetch("/api/medtech/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: target.id, sourceOrder: targetNextOrder }) }),
      ]);
      if (responses.some((response) => !response.ok)) { setNotice("原稿順序對調失敗，請稍後再試。"); return; }
      window.location.reload();
    } catch {
      setNotice("原稿順序對調失敗，請稍後再試。");
    } finally {
      setOrderBusy(false);
    }
  }

  async function upload(file: File, action: "audio" | "subtitle") {
    setBusy(true);
    setNotice(action === "audio" ? "正在上傳語音檔…" : "正在解析 SRT 字幕…");
    const form = new FormData();
    form.set("questionId", String(questionId));
    form.set("action", action);
    form.set("file", file, file.name);
    try {
      const response = await fetch(`/api/medtech/admin/question-media?questionId=${questionId}`, { method: "POST", body: form });
      const data = await response.json() as { error?: string; cues?: number; audioFileName?: string | null };
      if (!response.ok) { setNotice(data.error ?? "上傳失敗"); return; }
      setNotice(action === "audio" ? `語音檔已綁定本題：${data.audioFileName ?? file.name}` : `SRT 已匯入 ${data.cues ?? 0} 段字幕，可直接播放對照。`);
      await load();
    } catch {
      setNotice("上傳失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion() {
    if (!window.confirm(`確定刪除第 ${questionNumber || questionId} 題？題目內容、解析、語音檔與字幕都會刪除，且無法復原。`)) return;
    setBusy(true);
    setNotice("正在刪除本題…");
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: questionId }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setNotice(data.error ?? "刪除失敗");
        return;
      }
      window.location.reload();
    } catch {
      setNotice("刪除失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  const canPublishWithoutProofread = /^[A-D]$/.test(teacherAnswer);
  return <section className="question-media-panel">
    <div className="question-media-head">
      <div><h2>語音檔與字幕</h2><p>本題音檔、SRT 與題目 ID 綁定；播放時會在下方同步顯示字幕。</p></div>
      <div className="question-media-actions">
        <label className="question-media-button"><input ref={audioInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.webm" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file, "audio"); }} />{busy ? "處理中…" : media?.audioFileName ? "更換語音檔" : "上傳語音檔"}</label>
        <label className="question-media-button secondary"><input ref={subtitleInput} type="file" accept=".srt,application/x-subrip,text/plain" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file, "subtitle"); }} />上傳 SRT</label>
        {allowDelete && <button type="button" className="question-media-button danger" disabled={busy} onClick={() => void deleteQuestion()}>刪除本題</button>}
      </div>
    </div>
    <div className={`question-review-panel ${reviewStatus === "confirmed" ? "confirmed" : canPublishWithoutProofread ? "answer-ready" : "pending"}`}>
      <div><b>{reviewStatus === "confirmed" ? "本題已校對" : canPublishWithoutProofread ? "老師答案已確認" : "本題尚未校對"}</b><small>{questionStatus === "published" ? "目前已發布；取消校對會立即下架。" : canPublishWithoutProofread ? "已有有效老師答案，可免按校對直接發布；AI 答案與解析仍可另外產生。" : "沒有老師答案時，才需要先確認校對才能發布。"}</small></div>
      <div className="question-review-actions">{reviewStatus === "confirmed" ? <button type="button" className="danger" disabled={orderBusy} onClick={() => void updateReview("cancelReview")}>{questionStatus === "published" ? "取消校對並下架" : "取消校對"}</button> : canPublishWithoutProofread ? <span className="question-review-ready">可直接發布</span> : <button type="button" className="primary" disabled={orderBusy} onClick={() => void updateReview("confirmReview")}>確認校對完成</button>}<button type="button" className="secondary" onClick={() => window.dispatchEvent(new Event("medtech-filter-answer-conflicts"))}>搜尋全部答案差異</button></div>
    </div>
    <AnswerConflictPanel questionId={questionId} questionNumber={questionNumber} teacherAnswer={teacherAnswer} aiAnswer={simulatedAnswer} note={simulatedTeacherNote} onUpdated={(item) => { const nextTeacherAnswer = String(item.teacherAnswer || item.correctAnswer || teacherAnswer).trim().toUpperCase(); const nextAiAnswer = String(item.simulatedAnswer || simulatedAnswer).trim().toUpperCase(); setTeacherAnswer(nextTeacherAnswer); setSimulatedAnswer(nextAiAnswer); setSimulatedTeacherNote(String(item.simulatedTeacherNote || "").trim()); window.dispatchEvent(new CustomEvent("medtech-question-review-updated", { detail: { id: questionId, item } })); }} />
    <div className="question-order-panel">
      <div><b>原稿順序</b><small>目前清單依此欄位排列；題號可以和原稿順序不同。</small></div>
      <input type="number" min="1" value={sourceOrder} onChange={(event) => setSourceOrder(event.target.value ? Number(event.target.value) : "")} aria-label="原稿順序" />
      <button type="button" disabled={orderBusy} onClick={() => void saveOrder()}>儲存順序</button>
      <button type="button" className="secondary" disabled={orderBusy || !previousQuestion} onClick={() => void swapQuestion(previousQuestion, "up")}>↑ 與上一題對調</button>
      <button type="button" className="secondary" disabled={orderBusy || !nextQuestion} onClick={() => void swapQuestion(nextQuestion, "down")}>↓ 與下一題對調</button>
    </div>
    {notice && <p className="question-media-notice">{notice}</p>}
    {media?.audioUrl ? <div className="question-media-player">
      <audio controls preload="metadata" src={media.audioUrl} onTimeUpdate={(event) => { const current = event.currentTarget.currentTime; setActiveCue(media.cues.find((cue) => current >= cue.startSeconds && current <= cue.endSeconds) ?? null); }} onSeeked={(event) => { const current = event.currentTarget.currentTime; setActiveCue(media.cues.find((cue) => current >= cue.startSeconds && current <= cue.endSeconds) ?? null); }} />
      <div className={`question-media-subtitle${activeCue ? " has-text" : ""}`} aria-live="polite">{activeCue ? <><span>{formatTime(activeCue.startSeconds)}–{formatTime(activeCue.endSeconds)}</span>{activeCue.text}</> : media.cues.length ? "播放時會在這裡顯示 SRT 字幕" : "尚未匯入 SRT 字幕"}</div>
      <small>{media.audioFileName} · {media.cues.length ? `已同步 ${media.cues.length} 段字幕` : "尚無字幕"} · 第 {questionNumber} 題</small>
    </div> : <div className="question-media-empty">尚未上傳本題語音檔；可先上傳語音檔，再匯入同一題的 SRT 字幕。</div>}
  </section>;
}
