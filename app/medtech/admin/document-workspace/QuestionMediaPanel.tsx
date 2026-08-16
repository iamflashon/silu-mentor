"use client";

import { useEffect, useRef, useState } from "react";

type Cue = { id: number; startSeconds: number; endSeconds: number; text: string; sequence: number };
type Media = { solutionId: number; audioFileName: string | null; audioUrl: string; cues: Cue[] };

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function QuestionMediaPanel({ questionId, questionNumber }: { questionId: number; questionNumber: string }) {
  const [media, setMedia] = useState<Media | null>(null);
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const audioInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch(`/api/medtech/admin/question-media?questionId=${questionId}`, { cache: "no-store" });
    const data = await response.json() as { media?: Media | null; error?: string };
    if (response.ok) setMedia(data.media ?? null);
    else setNotice(data.error ?? "語音資料讀取失敗");
  }

  useEffect(() => {
    setMedia(null);
    setActiveCue(null);
    setNotice("");
    void load();
  }, [questionId]);

  async function upload(file: File, action: "audio" | "subtitle") {
    setBusy(true);
    setNotice(action === "audio" ? "正在上傳語音檔…" : "正在解析 SRT 字幕…");
    const form = new FormData();
    form.set("questionId", String(questionId));
    form.set("action", action);
    form.set("file", file, file.name);
    try {
      const response = await fetch("/api/medtech/admin/question-media", { method: "POST", body: form });
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

  return <section className="question-media-panel">
    <div className="question-media-head">
      <div><h2>語音檔與字幕</h2><p>本題音檔、SRT 與題目 ID 綁定；播放時會在下方同步顯示字幕。</p></div>
      <div className="question-media-actions">
        <label className="question-media-button"><input ref={audioInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.webm" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file, "audio"); }} />{busy ? "處理中…" : media?.audioFileName ? "更換語音檔" : "上傳語音檔"}</label>
        <label className="question-media-button secondary"><input ref={subtitleInput} type="file" accept=".srt,application/x-subrip,text/plain" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file, "subtitle"); }} />上傳 SRT</label>
        <button type="button" className="question-media-button danger" disabled={busy} onClick={() => void deleteQuestion()}>刪除本題</button>
      </div>
    </div>
    {notice && <p className="question-media-notice">{notice}</p>}
    {media?.audioUrl ? <div className="question-media-player">
      <audio controls preload="metadata" src={media.audioUrl} onTimeUpdate={(event) => { const current = event.currentTarget.currentTime; setActiveCue(media.cues.find((cue) => current >= cue.startSeconds && current <= cue.endSeconds) ?? null); }} onSeeked={(event) => { const current = event.currentTarget.currentTime; setActiveCue(media.cues.find((cue) => current >= cue.startSeconds && current <= cue.endSeconds) ?? null); }} />
      <div className={`question-media-subtitle${activeCue ? " has-text" : ""}`} aria-live="polite">{activeCue ? <><span>{formatTime(activeCue.startSeconds)}–{formatTime(activeCue.endSeconds)}</span>{activeCue.text}</> : media.cues.length ? "播放時會在這裡顯示 SRT 字幕" : "尚未匯入 SRT 字幕"}</div>
      <small>{media.audioFileName} · {media.cues.length ? `已同步 ${media.cues.length} 段字幕` : "尚無字幕"} · 第 {questionNumber} 題</small>
    </div> : <div className="question-media-empty">尚未上傳本題語音檔；可先上傳語音檔，再匯入同一題的 SRT 字幕。</div>}
  </section>;
}
