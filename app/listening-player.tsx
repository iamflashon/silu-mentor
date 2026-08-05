"use client";

import { useEffect, useRef, useState } from "react";
import { PlaybackRateSelect } from "./course-video-player";

export type ListeningFeed = {
  id: number;
  title: string;
  year: string;
  subject: string;
  questionText?: string;
  audioUrl: string;
  audioSegments?: Array<{
    id: number;
    audioUrl: string;
    durationSeconds: number;
    startOffsetSeconds?: number;
    sequence: number;
  }>;
  subtitles?: Array<{
    id: number;
    segmentId: number | null;
    startSeconds: number;
    endSeconds: number;
    text: string;
    sequence: number;
  }>;
};

export function ListeningPlayer({ item, compact = false }: { item: ListeningFeed; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [resumeAfterSwitch, setResumeAfterSwitch] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState("");
  const [showQuestion, setShowQuestion] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const segments = item.audioSegments?.length
    ? item.audioSegments
    : [{ id: item.id, audioUrl: item.audioUrl, durationSeconds: 0, startOffsetSeconds: 0, sequence: 0 }];
  const current = segments[segmentIndex];
  const subtitles = item.subtitles ?? [];

  function updateSubtitle() {
    const audio = audioRef.current;
    if (!audio || !subtitles.length) return;
    const elapsed = audio.currentTime + (current.startOffsetSeconds ?? 0);
    const cue = subtitles.find((item) => elapsed >= item.startSeconds && elapsed <= item.endSeconds);
    setActiveSubtitle(cue?.text ?? "");
  }

  useEffect(() => {
    setActiveSubtitle("");
  }, [segmentIndex]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, segmentIndex]);

  useEffect(() => {
    if (!resumeAfterSwitch || !audioRef.current) return;
    const playResult = audioRef.current.play();
    if (playResult) playResult.catch(() => undefined).finally(() => setResumeAfterSwitch(false));
    else setResumeAfterSwitch(false);
  }, [segmentIndex, resumeAfterSwitch]);

  return (
    <div className={`listening-player${compact ? " compact" : ""}`}>
      <button type="button" className="listening-title-button" onClick={() => setShowQuestion(true)}>
        {item.title}
        <span>查看完整題目</span>
      </button>
      <audio
        key={`${item.id}-${current.id}`}
        ref={audioRef}
        controls
        preload="none"
        src={current.audioUrl}
        onTimeUpdate={updateSubtitle}
        onSeeked={updateSubtitle}
        onEnded={() => {
          if (segmentIndex < segments.length - 1) {
            setResumeAfterSwitch(true);
            setSegmentIndex((value) => value + 1);
          }
        }}
      />
      <div className="listening-player-controls">
        <PlaybackRateSelect value={playbackRate} onChange={setPlaybackRate} />
      </div>
      <div className={`listening-subtitle${activeSubtitle ? " has-text" : ""}`} aria-live="polite">
        {activeSubtitle || (subtitles.length ? "播放時會在這裡顯示字幕" : "字幕尚未匯入")}
      </div>
      {segments.length > 1 && <small>分段 {segmentIndex + 1}/{segments.length}，播放完會自動接續</small>}
      {showQuestion && <div className="listening-question-backdrop" role="presentation" onClick={() => setShowQuestion(false)}>
        <section className="listening-question-modal" role="dialog" aria-modal="true" aria-label="完整題目" onClick={(event) => event.stopPropagation()}>
          <header><div><span>{item.year} · {item.subject}</span><h2>完整題目</h2></div><button type="button" onClick={() => setShowQuestion(false)} aria-label="關閉完整題目">×</button></header>
          <h3>{item.title}</h3>
          <p>{item.questionText || "這一題的完整題目尚未匯入，請到管理後台補上題目內容。"}</p>
        </section>
      </div>}
    </div>
  );
}
